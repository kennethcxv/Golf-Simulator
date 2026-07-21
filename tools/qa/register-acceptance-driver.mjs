import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
const VIEWPORT = { width: 1600, height: 900 };
const SKUS = (process.env.REGISTER_QA_SKUS || 'tees1,marker1,glove1')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
if (SKUS.length !== 3 || new Set(SKUS).size !== 3) {
  throw new Error('REGISTER_QA_SKUS must name exactly three distinct comma-separated products.');
}
const REQUIRE_OVERSIZE_HANDOFF = process.env.REGISTER_QA_REQUIRE_OVERSIZE_HANDOFF === '1';
const COUNTER_TOP = 1.055;
const CARRY_Y = COUNTER_TOP + 0.115;
const BAG = { x: 3.50, y: CARRY_Y, z: 4.44 };
const CARD_TERMINAL = { x: 2.05, y: COUNTER_TOP + 0.06, z: 3.88 };

function roundedPoint(point) {
  if (!point) return null;
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

async function boot(page, baseUrl = BASE_URL) {
  await page.goto(baseUrl);
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(1000);
  const continueButton = page.getByText('Continue', { exact: true });
  if (await continueButton.isEnabled().catch(() => false)) {
    await continueButton.click();
  } else {
    // A clean QA profile has no save to continue. Starting the relaxed fixture
    // is still the normal player-facing menu path and makes the driver usable
    // in isolated worktrees and clean-install CI runs.
    await page.getByText('New Empire — Relaxed', { exact: true }).click();
  }
  // Continue may restore an empire that has not bought its first property yet,
  // and a brand-new profile always opens the property market. Complete that
  // player-facing prerequisite instead of depending on leaked browser storage.
  const firstAffordableProperty = page.getByRole('button', { name: 'Buy', exact: true }).first();
  if (await firstAffordableProperty.isVisible({ timeout: 3000 }).catch(() => false)) {
    await firstAffordableProperty.click();
  }
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null,
  { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none'
      || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const runtime = window.__fw?.scene3d?.clubhouse?.()?.assets51to100Runtime?.diagnostics?.();
    return !runtime || (runtime.placed === 40 && runtime.failed === 0);
  }, null, { timeout: 40000 });
  await page.waitForTimeout(1200);
  // Exercise the same normal canvas click a player uses to resume first-person
  // control. Keeping the "Click to play" veil out of retained screenshots makes
  // the placement evidence represent the game rather than the automation shell.
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(140);
}

async function installReadOnlyProbe(page, skuIds) {
  await page.evaluate(async (acceptedSkuIds) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = () => app.scene3d.clubhouse();
    const localCentre = (object) => {
      const ch = clubhouse();
      const bounds = new THREE.Box3().setFromObject(object);
      const centre = bounds.isEmpty()
        ? object.getWorldPosition(new THREE.Vector3())
        : bounds.getCenter(new THREE.Vector3());
      const offset = ch.interior.position;
      return { x: centre.x - offset.x, y: centre.y - offset.y, z: centre.z - offset.z };
    };
    const ancestry = (object) => {
      const kinds = [];
      for (let p = object; p; p = p.parent) {
        if (p.userData && p.userData.kind) kinds.push(p.userData.kind);
      }
      return kinds;
    };
    const describe = (object) => {
      if (!object) return null;
      const centre = localCentre(object);
      return {
        ...centre,
        name: object.name || '',
        kind: object.userData.kind || null,
        uid: object.userData.uid || null,
        skuId: object.userData.skuId || null,
        denom: object.userData.denom == null ? null : Number(object.userData.denom),
        from: object.userData.from || null,
        pick: !!object.userData.pick,
        visible: object.visible,
        ancestry: ancestry(object),
      };
    };
    const objects = (predicate) => {
      const found = [];
      clubhouse().interior.traverse((object) => {
        if (object.visible && predicate(object)) found.push(object);
      });
      return found;
    };
    const project = (local) => {
      const ch = clubhouse();
      const v = new THREE.Vector3(
        local.x + ch.interior.position.x,
        local.y + ch.interior.position.y,
        local.z + ch.interior.position.z,
      );
      v.project(app.scene3d.camera);
      const rect = document.querySelector('canvas').getBoundingClientRect();
      return {
        x: rect.left + ((v.x + 1) / 2) * rect.width,
        y: rect.top + ((-v.y + 1) / 2) * rect.height,
        inView: v.z >= -1 && v.z <= 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
      };
    };
    const item = (uid) => {
      const object = objects((o) => o.userData && o.userData.kind === 'item'
        && o.userData.uid === uid)[0];
      if (!object) return null;
      const out = describe(object);
      const origin = object.getWorldPosition(new THREE.Vector3());
      const offset = clubhouse().interior.position;
      out.origin = { x: origin.x - offset.x, y: origin.y - offset.y, z: origin.z - offset.z };
      const bc = object.userData.bc;
      if (bc) {
        const barcode = bc.getWorldPosition(new THREE.Vector3());
        out.barcode = { x: barcode.x - offset.x, y: barcode.y - offset.y, z: barcode.z - offset.z };
        const q = bc.getWorldQuaternion(new THREE.Quaternion());
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
        out.barcodeNormal = { x: normal.x, y: normal.y, z: normal.z };
      }
      return out;
    };
    const money = (from, denom = null) => {
      const found = objects((o) => o.userData && o.userData.kind === 'money'
        && o.userData.from === from
        && (denom == null || Number(o.userData.denom) === Number(denom)));
      return found.length ? describe(found[found.length - 1]) : null;
    };
    const kind = (value, pickOnly = false) => {
      const found = objects((o) => o.userData && o.userData.kind === value
        && (!pickOnly || o.userData.pick));
      return found.length ? describe(found[0]) : null;
    };
    const named = (value, ancestorKind = null) => {
      const object = objects((entry) => entry.name === value
        && (!ancestorKind || ancestry(entry).includes(ancestorKind)))[0];
      return object ? describe(object) : null;
    };
    const receipt = () => {
      const found = objects((o) => o.userData && o.userData.kind === 'receipt');
      return found.map((o) => describe(o));
    };
    const customerList = () => {
      const ch = clubhouse();
      if (typeof ch.customers === 'function') return ch.customers();
      if (typeof ch.getCustomers === 'function') return ch.getCustomers();
      return Array.isArray(ch.customers) ? ch.customers : [];
    };
    const customer = (name) => {
      const c = customerList().find((entry) => entry.name === name);
      if (!c) return null;
      const offset = clubhouse().interior.position;
      return {
        name: c.name,
        phase: c.checkoutPhase,
        placed: c.checkoutPlacedCount,
        cart: (c.cart || []).map((entry) => ({
          uid: entry.uid, skuId: entry.skuId, placed: !!entry.placed,
        })),
        x: c.mesh.position.x - offset.x,
        z: c.mesh.position.z - offset.z,
        bought: !!c.bought,
        paid: !!c.paid,
      };
    };
    const snapshot = (name = null) => {
      const ch = clubhouse();
      const reg = ch.register;
      const tx = reg.getTx();
      const shop = app.state.shop;
      const cam = app.scene3d.camera;
      const cashObjects = objects((o) => o.userData && o.userData.kind === 'money');
      const lastTicket = Array.isArray(shop.transactionHistory) && shop.transactionHistory.length
        ? shop.transactionHistory[0] : null;
      return {
        active: reg.isActive(),
        flow: reg.getFlow ? reg.getFlow() : null,
        tx: tx ? {
          stage: tx.stage,
          method: tx.method,
          drawerOpen: !!tx.drawerOpen,
          deposited: !!tx.deposited,
          receiptPrinted: !!tx.receiptPrinted,
          banked: !!tx.banked,
          cardAttempts: tx.cardAttempts,
          cardsTried: tx.cardsTried,
          tenderedTotal: tx.tenderedTotal,
          tendered: { ...(tx.tendered || {}) },
          hand: { ...(tx.hand || {}) },
          items: tx.items.map((entry) => ({
            uid: entry.uid, skuId: entry.skuId, scanned: !!entry.scanned,
            staged: !!entry.staged, bagged: !!entry.bagged,
          })),
        } : null,
        customer: name ? customer(name) : null,
        queue: typeof ch.checkoutQueue === 'function' ? ch.checkoutQueue() : [],
        receipts: receipt(),
        bag: kind('bag'),
        palm: kind('palm'),
        money: cashObjects.reduce((acc, object) => {
          const key = `${object.userData.from}:${object.userData.denom}`;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
        books: {
          units: (shop.salesLive || {}).units || 0,
          revenue: (shop.salesLive || {}).revenue || 0,
          held: (shop.held || []).length,
          history: (shop.transactionHistory || []).length,
          lastTicket: lastTicket ? {
            number: lastTicket.number,
            customer: lastTicket.customer,
            method: lastTicket.method,
            total: lastTicket.total,
            items: Array.isArray(lastTicket.items) ? lastTicket.items.length : 0,
          } : null,
          shelf: Object.fromEntries(acceptedSkuIds.map((id) => [
            id, shop.inventory[id] ? shop.inventory[id].shelf : null,
          ])),
        },
        camera: {
          x: cam.position.x, y: cam.position.y, z: cam.position.z,
          qx: cam.quaternion.x, qy: cam.quaternion.y,
          qz: cam.quaternion.z, qw: cam.quaternion.w,
          fov: cam.fov,
        },
      };
    };

    window.__qaRegister = { project, item, money, kind, named, receipt, customer, snapshot };
  }, skuIds);
}

async function waitForCameraStable(page, timeout = 12000) {
  await page.evaluate(() => { window.__qaRegisterCameraProbe = null; });
  await page.waitForFunction(() => {
    const c = window.__fw.scene3d.camera;
    const now = {
      x: c.position.x, y: c.position.y, z: c.position.z,
      qx: c.quaternion.x, qy: c.quaternion.y,
      qz: c.quaternion.z, qw: c.quaternion.w,
    };
    const old = window.__qaRegisterCameraProbe;
    if (!old) {
      window.__qaRegisterCameraProbe = { ...now, stable: 0 };
      return false;
    }
    const delta = Math.hypot(
      now.x - old.x, now.y - old.y, now.z - old.z,
      now.qx - old.qx, now.qy - old.qy, now.qz - old.qz, now.qw - old.qw,
    );
    const stable = delta < 0.00035 ? old.stable + 1 : 0;
    window.__qaRegisterCameraProbe = { ...now, stable };
    return stable >= 7;
  }, null, { timeout, polling: 'raf' });
}

async function interpolateMouse(page, from, to, steps = 14, delay = 14) {
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    await page.mouse.move(
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
    );
    if (delay) await page.waitForTimeout(delay);
  }
  return to;
}

export async function runRegisterAcceptance(page, mode, { baseUrl = BASE_URL } = {}) {
  if (mode !== 'card' && mode !== 'cash') throw new Error(`Unsupported payment mode: ${mode}`);

  const evidenceRoot = process.env.REGISTER_QA_ROOT || 'qa/cash-register-production/acceptance';
  const out = path.resolve(evidenceRoot, mode);
  const captureOutput = process.env.REGISTER_CAPTURE_PATH
    ? path.resolve(process.env.REGISTER_CAPTURE_PATH.replaceAll('{mode}', mode))
    : null;
  fs.mkdirSync(out, { recursive: true });
  const errors = [];
  const warnings = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.type() === 'warning') warnings.push(message.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
    errors.push(`PAGEERROR: ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      error: request.failure() ? request.failure().errorText : 'unknown request failure',
    });
  });

  const log = [];
  const screenPoints = {};
  let currentStep = 'boot';
  let fixtureCustomer = null;
  let beforeBooks = null;
  let queueBeforeSale = null;
  let shotNo = 0;
  let captureActive = false;
  let captureEvidence = { requested: !!captureOutput };
  const saveResult = (result) => {
    fs.writeFileSync(path.join(out, 'latest-result.json'), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  };
  const shot = async (label) => {
    shotNo++;
    const number = String(shotNo).padStart(2, '0');
    const file = `${number}-${label}.png`;
    await page.screenshot({ path: path.join(out, file) });
    log.push({ evidence: file, step: currentStep });
    return file;
  };
  const snapshot = () => page.evaluate((name) => window.__qaRegister.snapshot(name), fixtureCustomer);
  const project = (point) => page.evaluate((value) => window.__qaRegister.project(value), point);
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const txState = () => page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx ? {
      stage: tx.stage,
      method: tx.method,
      items: tx.items.map((entry) => ({ ...entry })),
    } : null;
  });
  const waitStage = async (wanted, timeout = 16000) => {
    const stages = Array.isArray(wanted) ? wanted : [wanted];
    await page.waitForFunction((values) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx && values.includes(tx.stage);
    }, stages, { timeout });
  };
  const waitItem = (uid, key, value, timeout = 10000) => page.waitForFunction(([id, k, v]) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const item = tx && tx.items.find((entry) => entry.uid === id);
    return !!item && item[k] === v;
  }, [uid, key, value], { timeout });
  const startMediaCapture = async () => {
    if (!captureOutput) return;
    fs.mkdirSync(path.dirname(captureOutput), { recursive: true });
    const started = await page.evaluate(async () => {
      const audio = window.__fw && window.__fw.audio;
      if (!audio || typeof audio.startCapture !== 'function') {
        throw new Error('The game audio capture API is not available.');
      }
      // The acceptance profile must not inherit a muted developer setting and
      // accidentally certify a silent file. This only affects the ephemeral QA page.
      audio.setMuted(false);
      audio.setVolume(0.8);
      return audio.startCapture(document.getElementById('game'), { fps: 30 });
    });
    assert(started.audioTracks > 0, 'Acceptance capture did not expose a WebAudio track.');
    assert(started.videoTracks > 0, 'Acceptance capture did not expose a canvas video track.');
    assert(started.audioContextState === 'running',
      `Acceptance WebAudio context remained ${started.audioContextState}; refusing silent evidence.`);
    captureActive = true;
    captureEvidence = { requested: true, output: captureOutput, ...started };
    log.push({ action: 'audio-bearing canvas capture started', ...started });
  };
  const stopMediaCapture = async () => {
    if (!captureOutput || !captureActive) return captureEvidence;
    const downloadName = path.basename(captureOutput);
    try {
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
      const stopPromise = page.evaluate((name) => (
        window.__fw.audio.stopCapture({ downloadName: name })
      ), downloadName);
      const [download, stopped] = await Promise.all([downloadPromise, stopPromise]);
      const downloadFailure = await download.failure();
      if (downloadFailure) throw new Error(`Browser capture download failed: ${downloadFailure}`);
      await download.saveAs(captureOutput);
      const bytesOnDisk = fs.statSync(captureOutput).size;
      assert(bytesOnDisk > 0, 'The saved acceptance capture is empty.');
      assert(stopped.nonSilentAudioWindows > 0 && stopped.audioPeak > 0.0001,
        'The WebM had an audio track, but the live game master bus remained silent.');
      captureEvidence = {
        ...captureEvidence,
        ...stopped,
        output: captureOutput,
        bytesOnDisk,
      };
      log.push({ action: 'audio-bearing canvas capture saved', ...captureEvidence });
      return captureEvidence;
    } finally {
      captureActive = false;
    }
  };

  try {
    currentStep = 'boot game';
    await boot(page, baseUrl);
    await installReadOnlyProbe(page, SKUS);

    currentStep = 'deterministic register setup';
    beforeBooks = await page.evaluate((skuIds) => {
      const app = window.__fw;
      const shop = app.state.shop;
      // Silence organic walk-ins for the scripted run and empty the floor first: they spawn
      // on wall-clock time even with the sim paused, and a stray shopper still holding a
      // product at the end intermittently broke the exactly-once held/inventory assertions.
      // The checkout under test is unaffected — only the ambient RNG crowd is cleared, and
      // every held cart it was carrying goes back on the shelf before the baseline is read.
      const chFixture = app.scene3d.clubhouse();
      if (chFixture && typeof chFixture.setOrganicWalkins === 'function') chFixture.setOrganicWalkins(false);
      if (chFixture && typeof chFixture.clearWalkins === 'function') chFixture.clearWalkins();
      const books = {
        units: (shop.salesLive || {}).units || 0,
        revenue: (shop.salesLive || {}).revenue || 0,
        held: (shop.held || []).length,
        history: (shop.transactionHistory || []).length,
        shelf: Object.fromEntries(skuIds.map((id) => [id, shop.inventory[id].shelf])),
      };
      for (const id of Object.keys(shop.inventory)) {
        const inv = shop.inventory[id];
        if (skuIds.includes(id)) inv.shelf = Math.max(inv.shelf, 12);
      }
      // Non-round fixture pricing forces the cash branch to exercise nickel-aware
      // change in the common tender path while remaining ordinary shop pricing.
      shop.markup.accessories = 1.15;
      shop.markup.apparel = 1.15;
      app.speedIdx = 0;
      const clock = app.state.clock;
      clock.minutes = Math.floor(clock.minutes / 1440) * 1440 + 14 * 60;
      app.state.weather.today = {
        tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5,
      };
      app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.rebuildStock();
      const walk = app.scene3d.walk.state;
      const origin = clubhouse.interior.position;
      walk.x = 2.80 + origin.x;
      // Stand a little farther back than the minimum interaction distance so the
      // customer-placement evidence includes the complete physical POS bezel.
      walk.z = 5.35 + origin.z;
      walk.yaw = 0;
      walk.pitch = -0.18;
      return books;
    }, SKUS);

    currentStep = 'start audio-bearing canvas recording';
    await startMediaCapture();

    currentStep = 'customer approach';
    fixtureCustomer = await page.evaluate(([skuIds, payment]) => (
      window.__fw.scene3d.clubhouse().sendToCounter(skuIds, payment)
    ), [SKUS, mode]);
    assert(fixtureCustomer, 'sendToCounter could not create the three-product customer.');
    // sendToCounter is the last diagnostic boundary. Resume the same canvas focus
    // a normal player has before retaining any gameplay evidence, so the browser's
    // click-to-play veil cannot contaminate the placement sequence.
    await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
    await page.waitForTimeout(140);
    await shot('customer-approach');

    currentStep = 'sequential product placement';
    await page.waitForFunction(([name, count]) => {
      const ch = window.__fw.scene3d.clubhouse();
      const list = typeof ch.customers === 'function' ? ch.customers()
        : typeof ch.getCustomers === 'function' ? ch.getCustomers()
          : Array.isArray(ch.customers) ? ch.customers : [];
      const c = list.find((entry) => entry.name === name);
      return !!c && c.checkoutPhase === 'placing'
        && c.checkoutPlacedCount >= 1 && c.checkoutPlacedCount < count;
    }, [fixtureCustomer, SKUS.length], { timeout: 12000 });
    await shot('customer-placing-products');

    currentStep = 'products ready at register';
    await page.waitForFunction(() => {
      const reg = window.__fw.scene3d.clubhouse().register;
      const tx = reg.getTx();
      return !!tx && tx.items.length === 3;
    }, null, { timeout: 15000 });
    queueBeforeSale = (await snapshot()).queue;
    assert(queueBeforeSale.length > 0 && queueBeforeSale[0].name === fixtureCustomer,
      'The fixture customer never became the physical head of the checkout queue.');
    await shot('three-products-ready');

    currentStep = 'enter cashier mode with E';
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null,
      { timeout: 10000 });
    await waitForCameraStable(page);
    await shot('cashier-camera');

    currentStep = 'scan and stage three physical products';
    const initialTx = await txState();
    const stageTargets = await page.evaluate(async (count) => {
      const { REGISTER } = await import('/src/data/shopLayout.js');
      const zone = REGISTER.scannedStaging;
      return Array.from({ length: count }, (_, index) => ({
        x: zone.minX + 0.05 + (zone.maxX - zone.minX - 0.10)
          * (count === 1 ? 0.5 : index / (count - 1)),
        y: 1.055 + 0.115,
        z: (zone.minZ + zone.maxZ) / 2,
      }));
    }, initialTx.items.length);
    for (let index = 0; index < initialTx.items.length; index++) {
      const uid = initialTx.items[index].uid;
      const info = await page.evaluate((id) => window.__qaRegister.item(id), uid);
      assert(info, `Physical product ${uid} was not present on the counter.`);
      const from = await project({ x: info.x, y: info.y, z: info.z });
      assert(from.inView, `Physical product ${uid} projected outside the cashier camera.`);
      screenPoints[`item-${index + 1}`] = roundedPoint(from);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      const scannerAlignment = await page.evaluate(() => (
        window.__fw.scene3d.clubhouse().register.scanAlignment()
      ));
      let rotated = null;
      let barcodeFacing = null;
      for (let turn = 0; turn < 4; turn++) {
        // Products and scanner models may be authored at different rotations. Probe
        // the rendered normal against the scanner's actual ray after each real wheel
        // event rather than assuming a particular world-up convention.
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(70);
        rotated = await page.evaluate((id) => window.__qaRegister.item(id), uid);
        if (rotated?.barcodeNormal) {
          barcodeFacing = rotated.barcodeNormal.x * scannerAlignment.direction[0]
            + rotated.barcodeNormal.y * scannerAlignment.direction[1]
            + rotated.barcodeNormal.z * scannerAlignment.direction[2];
        }
        if (barcodeFacing != null && barcodeFacing <= -0.35) break;
      }
      assert(rotated && barcodeFacing != null && barcodeFacing <= -0.35,
        `Mouse wheel did not rotate ${uid}'s barcode toward the scanner (dot ${barcodeFacing}).`);
      if (index === 0) await shot('first-product-barcode-visible');

      // Drag the product origin so its authored barcode anchor—not a generic box
      // centre—crosses the physical scan glass. This matters for clubs, umbrellas,
      // and bags whose tag can be several tenths of a metre from the object origin.
      assert(rotated.origin && rotated.barcode,
        `Physical product ${uid} did not expose its authored origin/barcode anchor.`);
      let cursor = from;
      const barcodeOffset = {
        x: rotated.barcode.x - rotated.origin.x,
        y: rotated.barcode.y - rotated.origin.y,
        z: rotated.barcode.z - rotated.origin.z,
      };
      const carriedBarcodeY = CARRY_Y + barcodeOffset.y;
      const rayDistance = Math.abs(scannerAlignment.direction[1]) > 1e-5
        ? Math.min(0.20, Math.max(0.04,
          (carriedBarcodeY - scannerAlignment.origin[1]) / scannerAlignment.direction[1]))
        : 0.12;
      const scannerTarget = {
        x: scannerAlignment.origin[0] + scannerAlignment.direction[0] * rayDistance,
        z: scannerAlignment.origin[2] + scannerAlignment.direction[2] * rayDistance,
      };
      const scanOrigin = {
        x: scannerTarget.x - barcodeOffset.x,
        y: CARRY_Y,
        z: scannerTarget.z - barcodeOffset.z,
      };
      const scannerPx = await project(scanOrigin);
      assert(scannerPx.inView,
        `The cursor position needed to carry ${uid}'s barcode over the scanner was off camera.`);
      screenPoints.scanner = roundedPoint(scannerPx);
      cursor = await interpolateMouse(page, cursor, scannerPx, 16, 13);
      await waitItem(uid, 'scanned', true, 5000);
      if (index === 0) await shot('first-product-scan-light');

      // ProductScanned restores the wide camera while the mouse still owns the
      // prop. Wait for that physical lean to settle before projecting the mat;
      // otherwise the moving camera can carry the world point out from under the
      // cursor halfway through a perfectly normal drag.
      await waitForCameraStable(page);
      const stagePx = await project(stageTargets[index]);
      assert(stagePx.inView,
        `Bagging-mat staging point ${index + 1} was outside the cashier camera at ${Math.round(stagePx.x)},${Math.round(stagePx.y)}.`);
      screenPoints[`staging-${index + 1}`] = roundedPoint(stagePx);
      await interpolateMouse(page, cursor, stagePx, 14, 13);
      await page.mouse.up();
      await waitItem(uid, 'staged', true, 5000);
      log.push({ action: `product ${index + 1} rotated, scanned, and staged`, uid,
        barcodeFacing });
    }
    // Let the final placement hand retract and the scan-focus camera return to its
    // settled wide pose before judging the staged-product composition.
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height - 70);
    await page.waitForTimeout(520);
    await waitForCameraStable(page);
    await shot('all-products-scanned-and-staged');

    currentStep = 'total sale with T';
    await page.keyboard.press('t');
    await page.waitForFunction((payment) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx && tx.method === payment;
    }, mode, { timeout: 10000 });
    // Capture the physical customer-to-counter motion itself, rather than the
    // first frame where the prop is still hidden at the customer's wrist.
    // Capture the customer's item late enough in the physical reach to be
    // unmistakable, while it is still visibly moving toward the counter.
    await page.waitForTimeout(520);
    await shot(`${mode}-payment-presented`);

    if (mode === 'card') {
      currentStep = 'activate physical card terminal';
      // The customer now physically carries the card from their wrist to the
      // reader. Let that visible 0.68 s presentation finish before the cashier
      // reaches for the terminal, exactly as a player watching the motion would.
      await page.waitForTimeout(900);
      const terminalPx = await page.evaluate(() => (
        window.__fw.scene3d.clubhouse().register.cardTerminalScreenPoint()
      ));
      assert(terminalPx.inView, 'Card terminal was outside the cashier camera.');
      screenPoints.cardTerminal = roundedPoint(terminalPx);
      await page.mouse.click(terminalPx.x, terminalPx.y);
      await waitStage('card-ready');
      await waitForCameraStable(page);
      await shot('card-swipe-ready');

      let attempts = 0;
      while (attempts++ < 5) {
        currentStep = `mouse card swipe attempt ${attempts}`;
        let top = null;
        let bottom = null;
        let started = false;
        // Browser compositing can leave a toast above the channel for a frame after a
        // declined-card retry. Re-project and make a fresh normal mouse press if the
        // flow does not confirm that the physical channel actually caught the card.
        for (let startTry = 0; startTry < 3 && !started; startTry++) {
          const channel = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.swipeAt());
          top = await project(channel.top);
          bottom = await project(channel.bot);
          screenPoints.swipeChannelAttempt = {
            local: channel,
            top,
            bottom,
          };
          assert(top.inView && bottom.inView, 'The swipe channel endpoints were outside the swipe camera.');
          await page.mouse.move(top.x, top.y);
          await page.mouse.down();
          started = await page.waitForFunction(() => {
            const flow = window.__fw.scene3d.clubhouse().register.getFlow();
            return !!flow && flow.state === 'CardSwiping';
          }, null, { timeout: 900 }).then(() => true).catch(() => false);
          if (!started) {
            await page.mouse.up();
            await page.waitForTimeout(80);
          }
        }
        assert(started, `Card reader did not catch a top-of-channel mouse press at ${Math.round(top.x)},${Math.round(top.y)}.`);
        screenPoints.swipeTop = roundedPoint(top);
        screenPoints.swipeBottom = roundedPoint(bottom);
        let cursor = top;
        for (let segment = 1; segment <= 16; segment++) {
          const t = segment / 16;
          const next = {
            x: top.x + (bottom.x - top.x) * t,
            y: top.y + (bottom.y - top.y) * t,
          };
          await page.mouse.move(next.x, next.y);
          await page.waitForTimeout(10);
          cursor = next;
          if (attempts === 1 && segment === 8) await shot('physical-card-mid-swipe');
        }
        await page.mouse.up();
        log.push({ action: 'physical top-to-bottom swipe', attempt: attempts,
          from: roundedPoint(top), to: roundedPoint(cursor) });
        // A swipe judged too fast/slow/short leaves the flow at card-ready with a fumble
        // message instead of declining. Canvas/video capture overhead can nudge a clean
        // swipe into the slow band, so treat "still ready" as a retry — exactly what a real
        // player does when the terminal says "swipe again" — rather than a hard timeout.
        const swipeLanded = await page.waitForFunction(() => {
          const tx = window.__fw.scene3d.clubhouse().register.getTx();
          return !!tx && ['card-busy', 'receipt', 'card-declined'].includes(tx.stage);
        }, null, { timeout: 6000 }).then(() => true).catch(() => false);
        if (!swipeLanded) {
          log.push({ action: 'swipe fumbled (terminal still ready) — swiping again', attempt: attempts });
          await waitStage('card-ready', 3000).catch(() => {});
          continue;
        }
        if ((await txState()).stage === 'card-busy') await shot('card-processing');
        await waitStage(['receipt', 'card-declined'], 12000);
        const result = await txState();
        if (result.stage === 'receipt') break;
        await shot(`card-declined-attempt-${attempts}`);
        const retryTerminal = await project(CARD_TERMINAL);
        screenPoints[`retryTerminal-${attempts}`] = roundedPoint(retryTerminal);
        await page.mouse.click(retryTerminal.x, retryTerminal.y);
        await waitStage('card-ready');
        await waitForCameraStable(page);
      }
      assert((await txState()).stage === 'receipt', 'Five physical card swipes were declined.');
      currentStep = 'card approved';
      // Approval changes both the task state and the physical focus camera. Retain
      // the settled receipt/POS composition, not an arbitrary frame mid-lean.
      await waitForCameraStable(page);
      await shot('card-approved');
    } else {
      currentStep = 'take customer cash';
      // Cash is counted out piece-by-piece over 0.78 s; pickup is deliberately
      // gated until the customer's hand has reached the counter.
      await page.waitForTimeout(950);
      const tender = await page.evaluate(() => window.__qaRegister.money('tender'));
      assert(tender, 'Cash payment selected but no physical tender appeared.');
      const tenderPx = await project({ x: tender.x, y: tender.y, z: tender.z });
      screenPoints.tender = roundedPoint(tenderPx);
      await page.mouse.move(tenderPx.x, tenderPx.y);
      await page.mouse.down();
      await page.mouse.up();
      await waitStage('cash-drawer');
      await shot('cash-taken');

      currentStep = 'open physical cash drawer with D';
      await page.keyboard.press('d');
      await page.waitForFunction(() => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        return !!tx && tx.drawerOpen;
      }, null, { timeout: 6000 });
      await waitForCameraStable(page);
      await shot('cash-drawer-open');

      currentStep = 'deposit tender into matching compartments';
      for (let guard = 0; guard < 20; guard++) {
        const piece = await page.evaluate(() => window.__qaRegister.money('tender'));
        if (!piece) break;
        const slot = await page.evaluate((denom) => window.__qaRegister.money('drawer', denom), piece.denom);
        assert(slot, `Drawer had no visible ${piece.denom} compartment target.`);
        const from = await project({ x: piece.x, y: piece.y, z: piece.z });
        const to = await project({ x: slot.x, y: CARRY_Y, z: slot.z });
        screenPoints[`deposit-${guard + 1}`] = { from: roundedPoint(from), to: roundedPoint(to), denom: piece.denom };
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await interpolateMouse(page, from, to, 16, 13);
        await page.mouse.up();
        await page.waitForTimeout(100);
      }
      await page.waitForFunction(() => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        return !!tx && tx.deposited;
      }, null, { timeout: 7000 });
      await shot('all-cash-deposited');

      currentStep = 'physically select correct change';
      // Prove a coin is a real selectable/undoable drawer object even on the customer
      // RNG branch that tenders odd cents and therefore needs whole-dollar change.
      const undoCoin = await page.evaluate(() => window.__qaRegister.money('drawer', 0.2));
      assert(undoCoin, 'The physical drawer had no 20-unit coin available for the change undo check.');
      const undoCoinPx = await project({ x: undoCoin.x, y: undoCoin.y, z: undoCoin.z });
      screenPoints.changeCoinUndo = roundedPoint(undoCoinPx);
      await page.mouse.click(undoCoinPx.x, undoCoinPx.y);
      await page.waitForFunction(() => !!window.__qaRegister.money('change', 0.2), null, { timeout: 4000 });
      await shot('physical-coin-selected');
      const heldCoin = await page.evaluate(() => window.__qaRegister.money('change', 0.2));
      const heldCoinPx = await project({ x: heldCoin.x, y: heldCoin.y, z: heldCoin.z });
      screenPoints.changeCoinUndoReturn = roundedPoint(heldCoinPx);
      await page.mouse.click(heldCoinPx.x, heldCoinPx.y);
      await page.waitForFunction(() => !window.__qaRegister.money('change', 0.2), null, { timeout: 4000 });
      log.push({ action: 'physical 20-unit coin selected then returned to its drawer compartment' });

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
      log.push({ action: 'change plan read from visible drawer', ...change });
      for (const [denom, count] of Object.entries(change.plan)) {
        for (let index = 0; index < count; index++) {
          const piece = await page.evaluate((value) => window.__qaRegister.money('drawer', Number(value)), denom);
          assert(piece, `Visible ${denom} change piece disappeared before selection ${index + 1}/${count}.`);
          const point = await project({ x: piece.x, y: piece.y, z: piece.z });
          screenPoints[`change-${denom}-${index + 1}`] = roundedPoint(point);
          await page.mouse.click(point.x, point.y);
          await page.waitForTimeout(90);
        }
      }
      await waitForCameraStable(page);
      await shot('correct-change-selected');

      currentStep = 'hand change to customer palm';
      await waitForCameraStable(page);
      const palm = await page.evaluate(() => window.__qaRegister.kind('palm'));
      assert(palm && palm.visible, 'Correct change was selected but the customer palm was not visible.');
      const palmPx = await project({ x: palm.x, y: palm.y, z: palm.z });
      assert(palmPx.inView, `Customer palm left the change-handoff camera (${Math.round(palmPx.x)},${Math.round(palmPx.y)}).`);
      screenPoints.changePalm = roundedPoint(palmPx);
      await page.mouse.click(palmPx.x, palmPx.y);
      await page.waitForFunction(() => {
        const register = window.__fw.scene3d.clubhouse().register;
        const flow = register.getFlow ? register.getFlow() : null;
        return !!flow && flow.state === 'GivingChange';
      }, null, { timeout: 4000 });
      await page.waitForTimeout(250);
      await shot('change-cash-in-motion-to-customer');
      await waitStage('receipt', 8000);
      await page.waitForTimeout(260);
      await shot('change-handed-drawer-closing');
    }

    currentStep = 'receipt emerges from the physical printer';
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx && tx.stage === 'receipt' && window.__qaRegister.receipt().length > 0;
    }, null, { timeout: 6000 });
    await page.waitForTimeout(220);
    await waitForCameraStable(page);
    await shot('receipt-emerging-from-printer');

    currentStep = 'receipt visibly finishes printing';
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const receipt = window.__qaRegister.receipt().find((entry) => entry.pick);
      return !!tx && tx.stage === 'receipt' && tx.receiptPrinted && !!receipt;
    }, null, { timeout: 14000 });
    await waitForCameraStable(page);
    await shot('receipt-printed');

    currentStep = 'drag receipt into bag';
    const receipt = await page.evaluate(() => window.__qaRegister.receipt().find((entry) => entry.pick));
    assert(receipt, 'Printed receipt never became a physical pickable object.');
    const receiptPx = await project({ x: receipt.x, y: receipt.y, z: receipt.z });
    screenPoints.receipt = roundedPoint(receiptPx);
    await page.mouse.move(receiptPx.x, receiptPx.y);
    await page.mouse.down();
    await waitStage('bagging', 6000);
    await waitForCameraStable(page);
    const liveBagForReceipt = await page.evaluate(() => window.__qaRegister.kind('bag'));
    const receiptBagPx = await project(liveBagForReceipt || BAG);
    screenPoints.receiptBag = roundedPoint(receiptBagPx);
    await interpolateMouse(page, receiptPx, receiptBagPx, 18, 13);
    await page.mouse.up();
    await page.waitForFunction(() => window.__qaRegister.receipt()
      .some((entry) => entry.ancestry.includes('bag') && !entry.pick), null, { timeout: 6000 });
    await shot('receipt-inside-bag');

    currentStep = 'drag all products into bag';
    let bagAction = 0;
    for (let guard = 0; guard < 9; guard++) {
      const before = await txState();
      const unbagged = before.items.filter((item) => !item.bagged);
      if (!unbagged.length) break;
      // Work from the customer-side edge toward the camera. If two packages overlap
      // in projection, the ray may legitimately catch the front one; the assertion
      // below follows whichever physical package the cursor actually picked.
      const candidates = [];
      for (const item of unbagged) {
        const info = await page.evaluate((id) => window.__qaRegister.item(id), item.uid);
        if (info) candidates.push({ item, info });
      }
      candidates.sort((a, b) => b.info.z - a.info.z);
      let candidate = null;
      let from = null;
      const hitOffsets = [
        { x: 0, y: 0 }, { x: -14, y: 0 }, { x: 14, y: 0 },
        { x: 0, y: -14 }, { x: 0, y: 14 },
        { x: -28, y: -12 }, { x: 28, y: -12 },
        { x: -28, y: 12 }, { x: 28, y: 12 },
      ];
      for (const possible of candidates) {
        const centre = await project({ x: possible.info.x, y: possible.info.y, z: possible.info.z });
        if (!centre.inView) continue;
        for (const offset of hitOffsets) {
          const point = { x: centre.x + offset.x, y: centre.y + offset.y, inView: true };
          if (point.x < 1 || point.x >= VIEWPORT.width - 1
              || point.y < 1 || point.y >= VIEWPORT.height - 1) continue;
          const picked = await page.evaluate(({ x, y }) => (
            window.__fw.scene3d.clubhouse().register.debugPickAt(x, y)
          ), point);
          if (picked?.physical?.kind === 'item' && picked.physical.uid === possible.item.uid) {
            candidate = possible;
            from = point;
            break;
          }
        }
        if (candidate) break;
      }
      assert(candidate && from, 'No visible hit point remained for an unbagged physical product.');
      const liveBag = await page.evaluate(() => window.__qaRegister.kind('bag'));
      const to = await project(liveBag || BAG);
      assert(from.inView && to.inView,
        `Bagging drag left the bagging camera (${Math.round(from.x)},${Math.round(from.y)} to ${Math.round(to.x)},${Math.round(to.y)}).`);
      bagAction++;
      screenPoints[`bag-product-${bagAction}`] = { from: roundedPoint(from), to: roundedPoint(to), aimedUid: candidate.item.uid };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await interpolateMouse(page, from, to, 16, 13);
      await page.mouse.up();
      const beforeCount = before.items.filter((item) => item.bagged).length;
      const advanced = await page.waitForFunction((count) => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        return !!tx && tx.items.filter((item) => item.bagged).length > count;
      }, beforeCount, { timeout: 1800 }).then(() => true).catch(() => false);
      if (advanced) {
        const after = await txState();
        const actual = after.items.find((item) => item.bagged
          && !before.items.find((old) => old.uid === item.uid).bagged);
        log.push({ action: 'physical product dragged into bag', aimedUid: candidate.item.uid,
          baggedUid: actual && actual.uid });
        if (beforeCount === 0) {
          // The runtime now lowers the released package through a visible arc. Wait
          // for its apex rather than capturing the release frame before it has moved.
          await page.waitForTimeout(180);
          await shot('first-product-entering-bag');
        }
      }
    }
    // Let the last package settle below the rim before proving the packed state and
    // attempting the handle grab. This is observed physical time, not a state skip.
    await page.waitForTimeout(720);
    const packedTx = await txState();
    assert(packedTx.items.every((item) => item.bagged),
      `${packedTx.items.filter((item) => !item.bagged).length} physical products remained outside the bag.`);
    await shot('all-products-and-receipt-bagged');

    currentStep = 'drag filled bag handles to customer';
    const palm = await page.evaluate(() => window.__qaRegister.kind('palm'));
    assert(palm && palm.visible, 'Filled bag was ready but the handoff palm was not visible.');
    const handleTargets = await page.evaluate(() => ([
      window.__qaRegister.named('ANCHOR_BagHandleFront', 'bag'),
      window.__qaRegister.named('ANCHOR_BagHandleBack', 'bag'),
      window.__qaRegister.named('BagHandleFrontPivot', 'bag'),
      window.__qaRegister.named('BagHandleBackPivot', 'bag'),
      window.__qaRegister.kind('bag'),
    ].filter(Boolean)));
    assert(handleTargets.length, 'The shopping bag had no physical handle target.');
    let handlePx = null;
    let bagCaught = false;
    // Confirm the register flow saw a handle grab before pulling. This guards against
    // a packed product intercepting the ray and gives both authored handles a normal
    // click opportunity without using any internal action hook.
    for (const handle of handleTargets) {
      const base = await project({ x: handle.x, y: handle.y, z: handle.z });
      for (const offset of [{ x: 0, y: 0 }, { x: -8, y: 0 }, { x: 8, y: 0 }, { x: 0, y: -8 }]) {
        const point = { x: base.x + offset.x, y: base.y + offset.y };
        if (point.x < 1 || point.x >= VIEWPORT.width - 1 || point.y < 1 || point.y >= VIEWPORT.height - 1) continue;
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        bagCaught = await page.waitForFunction(() => {
          const flow = window.__fw.scene3d.clubhouse().register.getFlow();
          return !!flow && flow.state === 'BagHandoff';
        }, null, { timeout: 700 }).then(() => true).catch(() => false);
        if (bagCaught) { handlePx = point; break; }
        await page.mouse.up();
      }
      if (bagCaught) break;
    }
    assert(bagCaught, 'Visible bag-handle mouse presses never selected the filled shopping bag.');
    await waitForCameraStable(page);
    const livePalm = await page.evaluate(() => window.__qaRegister.kind('palm'));
    assert(livePalm && livePalm.visible, 'Customer hand disappeared during the bag-handoff camera move.');
    const handoffPx = await project({ x: livePalm.x, y: livePalm.y, z: livePalm.z });
    screenPoints.bagHandle = roundedPoint(handlePx);
    screenPoints.bagHandoff = roundedPoint(handoffPx);
    await interpolateMouse(page, handlePx, handoffPx, 20, 14);
    await page.mouse.up();
    // Retain the physical offer after release, while the bag is easing from the
    // receiving palm to its torso-height ownership target. The cursor-held frame
    // puts the handles over the face for a single instant and is not the completed
    // interaction the player actually judges.
    await page.waitForTimeout(320);
    await shot('filled-bag-offered-to-customer');

    currentStep = 'transaction banks exactly once';
    await page.waitForFunction(([units, history]) => {
      const shop = window.__fw.state.shop;
      return ((shop.salesLive || {}).units || 0) === units + 3
        && (shop.transactionHistory || []).length === history + 1
        && !window.__fw.scene3d.clubhouse().register.hasTx();
    }, [beforeBooks.units, beforeBooks.history], { timeout: 12000 });
    const acceptanceCustomer = await page.evaluate(async ({ name, viewport }) => {
      const THREE = await import('three');
      const ch = window.__fw.scene3d.clubhouse();
      const list = typeof ch.customers === 'function' ? ch.customers()
        : typeof ch.getCustomers === 'function' ? ch.getCustomers()
          : Array.isArray(ch.customers) ? ch.customers : [];
      const customer = list.find((entry) => entry.name === name);
      if (!customer) return null;
      let paidBag = null;
      if (customer.bagMesh) {
        customer.bagMesh.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(customer.bagMesh);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const projected = center.clone().project(window.__fw.scene3d.camera);
        paidBag = {
          center: { x: center.x, y: center.y, z: center.z },
          size: { x: size.x, y: size.y, z: size.z },
          screen: {
            x: (projected.x + 1) * viewport.width / 2,
            y: (1 - projected.y) * viewport.height / 2,
            inView: Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && projected.z >= -1 && projected.z <= 1,
          },
          descendants: [...function* walk(node) { yield node; for (const child of node.children) yield* walk(child); }(customer.bagMesh)].length,
        };
      }
      let oversizeCarry = null;
      if (customer.oversizeCarryRoot) {
        customer.oversizeCarryRoot.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(customer.oversizeCarryRoot);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const projected = center.clone().project(window.__fw.scene3d.camera);
        oversizeCarry = {
          childCount: customer.oversizeCarryRoot.children.length,
          uids: customer.oversizeCarryRoot.children.map((child) => child.userData.checkoutUid).filter(Boolean),
          center: { x: center.x, y: center.y, z: center.z },
          size: { x: size.x, y: size.y, z: size.z },
          screen: {
            x: (projected.x + 1) * viewport.width / 2,
            y: (1 - projected.y) * viewport.height / 2,
            inView: Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && projected.z >= -1 && projected.z <= 1,
          },
        };
      }
      return {
        x: customer.mesh.position.x,
        z: customer.mesh.position.z,
        ownsBag: !!customer.bagMesh,
        bagVisible: !!(customer.bagMesh && customer.bagMesh.visible),
        paidBag,
        oversizeCarry,
      };
    }, { name: fixtureCustomer, viewport: VIEWPORT });
    assert(acceptanceCustomer && acceptanceCustomer.ownsBag && acceptanceCustomer.bagVisible,
      'The transaction banked, but the customer did not visibly own the paid bag.');
    assert(acceptanceCustomer.paidBag && acceptanceCustomer.paidBag.screen.inView,
      'The customer owned the paid bag, but it was outside the cashier camera.');
    if (REQUIRE_OVERSIZE_HANDOFF) {
      assert(acceptanceCustomer.oversizeCarry
        && acceptanceCustomer.oversizeCarry.childCount === SKUS.length,
      'The customer did not visibly own all three separately handed oversize products.');
      assert(new Set(acceptanceCustomer.oversizeCarry.uids).size === SKUS.length,
        'The oversize customer carry duplicated or lost a transaction product uid.');
      assert(JSON.stringify([...acceptanceCustomer.oversizeCarry.uids].sort())
        === JSON.stringify(initialTx.items.map((item) => item.uid).sort()),
      'The oversize customer carry does not match the exact banked transaction products.');
      assert(acceptanceCustomer.oversizeCarry.screen.inView,
        'The separately handed oversize products left the cashier camera during acceptance.');
    }
    log.push({ action: 'customer owns visible paid bag', paidBag: acceptanceCustomer.paidBag });
    if (acceptanceCustomer.oversizeCarry) {
      log.push({ action: 'customer owns visible separately handed oversize goods',
        oversizeCarry: acceptanceCustomer.oversizeCarry });
    }
    await shot('customer-accepts-bag');

    currentStep = 'customer leaves checkout';
    await page.waitForFunction(({ name, x, z }) => {
      const ch = window.__fw.scene3d.clubhouse();
      const list = typeof ch.customers === 'function' ? ch.customers()
        : typeof ch.getCustomers === 'function' ? ch.getCustomers()
          : Array.isArray(ch.customers) ? ch.customers : [];
      const c = list.find((entry) => entry.name === name);
      return !c || Math.hypot(c.mesh.position.x - x, c.mesh.position.z - z) > 1.15;
    }, { name: fixtureCustomer, x: acceptanceCustomer.x, z: acceptanceCustomer.z }, { timeout: 12000 });
    const departingCarry = await page.evaluate((name) => {
      const ch = window.__fw.scene3d.clubhouse();
      const list = typeof ch.customers === 'function' ? ch.customers()
        : typeof ch.getCustomers === 'function' ? ch.getCustomers()
          : Array.isArray(ch.customers) ? ch.customers : [];
      const c = list.find((entry) => entry.name === name);
      return !c ? { gone: true, bag: true, oversize: true } : {
        gone: false,
        bag: !!(c.bagMesh && c.bagMesh.visible),
        oversize: !!(c.oversizeCarryRoot && c.oversizeCarryRoot.visible
          && c.oversizeCarryRoot.children.length === 3),
      };
    }, fixtureCustomer);
    assert(departingCarry.bag, 'The customer moved away but lost the paid bag during departure.');
    if (REQUIRE_OVERSIZE_HANDOFF) {
      assert(departingCarry.oversize,
        'The customer moved away but lost separately handed oversize goods during departure.');
    }
    await shot('customer-leaving');

    currentStep = 'return to shop through checkout monitor';
    const exitPoint = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.monitorScreenPoint('exit')
    ));
    assert(exitPoint && exitPoint.inView,
      'The completed checkout did not expose a visible Return to Shop control.');
    screenPoints.returnToShop = roundedPoint(exitPoint);
    await page.mouse.click(exitPoint.x, exitPoint.y);
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.isActive(), null,
      { timeout: 5000 });
    // Returning to normal first-person control is part of the recording. A normal
    // canvas click restores pointer lock and removes the automation-only play veil.
    await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
    await page.waitForTimeout(140);

    const final = await snapshot();
    assert(!final.tx && !final.active, 'Transaction banked but register mode remained active.');
    assert(final.books.units === beforeBooks.units + 3, 'Sale units were not booked exactly once.');
    assert(final.books.history === beforeBooks.history + 1, 'Transaction history was not updated exactly once.');
    assert(final.books.held === beforeBooks.held, 'Held inventory did not return to its pre-customer count.');
    assert(final.books.lastTicket && final.books.lastTicket.customer === fixtureCustomer,
      'The new transaction-history ticket does not belong to the served customer.');
    assert(final.books.lastTicket.method === mode && final.books.lastTicket.items === 3,
      'The banked ticket does not match the three-item physical payment branch.');
    assert(Math.round((final.books.revenue - beforeBooks.revenue) * 100)
      === Math.round(final.books.lastTicket.total * 100),
    'Live revenue did not increase by exactly the single banked ticket total.');
    assert(queueBeforeSale.length === final.queue.length + 1
      && !final.queue.some((entry) => entry.name === fixtureCustomer),
    'The served customer was not removed from the physical checkout queue exactly once.');
    for (const skuId of SKUS) {
      const stockedBeforeFixture = Math.max(beforeBooks.shelf[skuId], 12);
      assert(final.books.shelf[skuId] === stockedBeforeFixture - 1,
        `${skuId} shelf stock did not decrease exactly once.`);
    }

    currentStep = 'verify browser diagnostics';
    const nonAbortedRequests = failedRequests.filter((entry) => !entry.error.includes('ERR_ABORTED'));
    assert(errors.length === 0, `Acceptance recorded ${errors.length} console/page errors.`);
    assert(pageErrors.length === 0, `Acceptance recorded ${pageErrors.length} page errors.`);
    assert(nonAbortedRequests.length === 0,
      `Acceptance recorded ${nonAbortedRequests.length} non-aborted request failures.`);

    currentStep = 'save audio-bearing canvas recording';
    await stopMediaCapture();

    return saveResult({
      ok: true,
      mode,
      products: SKUS,
      oversizeHandoffRequired: REQUIRE_OVERSIZE_HANDOFF,
      customer: fixtureCustomer,
      viewport: VIEWPORT,
      videoRequested: !!process.env.VIDEO_DIR,
      audioVideoCapture: captureEvidence,
      evidenceDirectory: out,
      beforeBooks,
      final,
      screenPoints,
      log,
      console: {
        errors: errors.slice(0, 20),
        pageErrors: pageErrors.slice(0, 20),
        failedRequests: failedRequests.slice(0, 50),
        nonAbortedFailedRequests: failedRequests.filter((entry) => !entry.error.includes('ERR_ABORTED')).slice(0, 20),
        warningCount: warnings.length,
        warnings: warnings.slice(0, 20),
      },
    });
  } catch (error) {
    if (captureActive) {
      try {
        await stopMediaCapture();
      } catch (captureError) {
        captureEvidence = { ...captureEvidence, stopError: captureError.message };
      }
    }
    const safe = currentStep.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72);
    await page.screenshot({ path: path.join(out, `99-blocker-${safe || 'unknown'}.png`) }).catch(() => {});
    const blocked = await snapshot().catch((snapshotError) => ({ snapshotError: snapshotError.message }));
    return saveResult({
      ok: false,
      mode,
      products: SKUS,
      oversizeHandoffRequired: REQUIRE_OVERSIZE_HANDOFF,
      customer: fixtureCustomer,
      viewport: VIEWPORT,
      videoRequested: !!process.env.VIDEO_DIR,
      audioVideoCapture: captureEvidence,
      evidenceDirectory: out,
      blocker: { step: currentStep, message: error.message, state: blocked, screenPoints },
      beforeBooks,
      log,
      console: {
        errors: errors.slice(0, 20),
        pageErrors: pageErrors.slice(0, 20),
        failedRequests: failedRequests.slice(0, 50),
        nonAbortedFailedRequests: failedRequests.filter((entry) => !entry.error.includes('ERR_ABORTED')).slice(0, 20),
        warningCount: warnings.length,
        warnings: warnings.slice(0, 20),
      },
    });
  }
}

import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://localhost:8457/';
const DEFAULT_VIEWPORT = Object.freeze({ width: 1600, height: 900 });
const DEFAULT_CYCLES = 20;
const SKUS = Object.freeze(['tees1', 'marker1', 'glove1']);
let VIEWPORT = { ...DEFAULT_VIEWPORT };

function assert(value, message) {
  if (!value) throw new Error(message);
}

function configureViewport(value) {
  const raw = String(value || '').trim().toLowerCase().replace('\u00d7', 'x');
  if (!raw) {
    VIEWPORT = { ...DEFAULT_VIEWPORT };
    return `${VIEWPORT.width}x${VIEWPORT.height}`;
  }
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(raw);
  if (!match) throw new Error(`Invalid lifecycle viewport "${value}". Use WIDTHxHEIGHT.`);
  VIEWPORT = { width: Number(match[1]), height: Number(match[2]) };
  assert(VIEWPORT.width >= 640 && VIEWPORT.height >= 360,
    `Lifecycle viewport ${raw} is too small for the checkout route.`);
  return `${VIEWPORT.width}x${VIEWPORT.height}`;
}

function configureCycles(value) {
  const parsed = Number(value);
  const cycles = Number.isFinite(parsed) ? Math.floor(parsed) : DEFAULT_CYCLES;
  assert(cycles >= 2 && cycles <= 40, `REGISTER_QA_CYCLES must be between 2 and 40, got ${value}.`);
  return cycles;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function boot(page) {
  await page.setViewportSize(VIEWPORT);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 50000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    if (!veil) return true;
    const style = getComputedStyle(veil);
    return style.display === 'none' || Number.parseFloat(style.opacity || '1') <= 0.01;
  }, null, { timeout: 50000 });
  await page.waitForTimeout(1200);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);
}

async function setupFixture(page, cycles) {
  return page.evaluate(({ skuIds, count }) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    for (const skuId of skuIds) {
      const inventory = app.state.shop.inventory[skuId];
      inventory.shelf = Math.max(inventory.shelf, count + 12);
    }
    app.state.shop.markup.accessories = 1.15;
    app.state.shop.markup.apparel = 1.15;
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72,
      tempLoF: 54,
      rainIn: 0,
      humidity: 0.48,
      windMph: 5,
    };
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    clubhouse.rebuildStock();
    const walk = app.scene3d.walk.state;
    const offset = clubhouse.interior.position;
    walk.x = 2.80 + offset.x;
    walk.z = 5.10 + offset.z;
    walk.yaw = 0;
    walk.pitch = -0.18;
    const shop = app.state.shop;
    return {
      units: shop.salesLive?.units || 0,
      revenue: shop.salesLive?.revenue || 0,
      history: (shop.transactionHistory || []).length,
      held: (shop.held || []).length,
      cash: app.state.cash,
      nextTransactionNo: Number(shop.nextTransactionNo || 1),
      shelf: Object.fromEntries(skuIds.map((skuId) => [skuId, shop.inventory[skuId].shelf])),
    };
  }, { skuIds: SKUS, count: cycles });
}

async function installListenerProbe(page) {
  await page.evaluate(() => {
    if (window.__registerLifecycleProbe) return;
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const counters = Object.create(null);
    const targetName = (target) => {
      if (target === window) return 'window';
      if (target === document) return 'document';
      if (target === document.querySelector('canvas')) return 'game-canvas';
      if (target instanceof Element) return target.tagName.toLowerCase();
      return target?.constructor?.name || 'other';
    };
    const bump = (target, type, delta) => {
      const key = `${targetName(target)}:${String(type)}`;
      counters[key] = (counters[key] || 0) + delta;
    };
    EventTarget.prototype.addEventListener = function registerLifecycleAdd(type, listener, options) {
      bump(this, type, 1);
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function registerLifecycleRemove(type, listener, options) {
      bump(this, type, -1);
      return originalRemove.call(this, type, listener, options);
    };
    window.__registerLifecycleProbe = {
      counters,
      installedAtMs: performance.now(),
    };
  });
}

async function installResourceLifecycleProbe(page) {
  await page.evaluate(async () => {
    if (window.__registerResourceLifecycleProbe) return;
    const THREE = await import('/vendor/three.module.js');
    const probe = {
      current: { cycle: 0, phase: 'probe-install' },
      geometries: Object.create(null),
      disposalEvents: [],
      phaseMarks: [],
      lastLive: new Set(),
    };
    const originalDispose = THREE.BufferGeometry.prototype.dispose;
    THREE.BufferGeometry.prototype.dispose = function registerLifecycleGeometryDispose() {
      const entry = probe.geometries[this.uuid] || {
        uuid: this.uuid,
        type: this.type || this.constructor?.name || 'BufferGeometry',
        names: [],
        kinds: [],
        from: [],
        ancestry: [],
        cycles: [],
        firstSeen: null,
        lastSeen: null,
        disposeCalls: 0,
        disposeEvents: [],
      };
      probe.geometries[this.uuid] = entry;
      entry.disposeCalls += 1;
      const event = {
        uuid: this.uuid,
        type: entry.type,
        cycle: probe.current.cycle,
        phase: probe.current.phase,
        names: [...entry.names],
        kinds: [...entry.kinds],
        from: [...entry.from],
      };
      entry.disposeEvents.push(event);
      probe.disposalEvents.push(event);
      return originalDispose.call(this);
    };
    window.__registerResourceLifecycleProbe = probe;
  });
}

async function markResourcePhase(page, cycle, phase) {
  return page.evaluate(({ cycleNumber, phaseName }) => {
    const app = window.__fw;
    const scene = app.scene3d.scene;
    const probe = window.__registerResourceLifecycleProbe;
    if (!probe) throw new Error('Resource lifecycle probe is not installed.');
    probe.current = { cycle: cycleNumber, phase: phaseName };
    const addLimited = (array, value, limit = 12) => {
      if (value != null && value !== '' && !array.includes(value) && array.length < limit) array.push(value);
    };
    const live = new Set();
    scene.traverse((object) => {
      const geometry = object.geometry;
      if (!geometry?.uuid) return;
      live.add(geometry.uuid);
      let entry = probe.geometries[geometry.uuid];
      if (!entry) {
        entry = {
          uuid: geometry.uuid,
          type: geometry.type || geometry.constructor?.name || 'BufferGeometry',
          names: [],
          kinds: [],
          from: [],
          ancestry: [],
          cycles: [],
          firstSeen: { cycle: cycleNumber, phase: phaseName },
          lastSeen: null,
          disposeCalls: 0,
          disposeEvents: [],
        };
        probe.geometries[geometry.uuid] = entry;
      }
      entry.lastSeen = { cycle: cycleNumber, phase: phaseName };
      addLimited(entry.cycles, cycleNumber, 24);
      addLimited(entry.names, object.name || '(unnamed)');
      addLimited(entry.kinds, object.userData?.kind || null);
      addLimited(entry.from, object.userData?.from || null);
      const ancestry = [];
      let cursor = object;
      for (let depth = 0; cursor && depth < 5; depth += 1, cursor = cursor.parent) {
        if (cursor.name) ancestry.push(cursor.name);
      }
      addLimited(entry.ancestry, ancestry.join(' < '));
    });
    const initializingBaseline = probe.lastLive.size === 0 && cycleNumber === 0;
    const added = initializingBaseline
      ? []
      : [...live].filter((uuid) => !probe.lastLive.has(uuid));
    const removed = [...probe.lastLive].filter((uuid) => !live.has(uuid));
    probe.lastLive = live;
    const focused = (uuid) => {
      const entry = probe.geometries[uuid];
      return {
        uuid,
        type: entry?.type || null,
        names: entry?.names || [],
        kinds: entry?.kinds || [],
        from: entry?.from || [],
        ancestry: entry?.ancestry || [],
        disposeCalls: entry?.disposeCalls || 0,
      };
    };
    const mark = {
      cycle: cycleNumber,
      phase: phaseName,
      rendererGeometries: app.scene3d.renderer.info.memory.geometries,
      rendererTextures: app.scene3d.renderer.info.memory.textures,
      liveGeometryCount: live.size,
      added: added.map(focused),
      removed: removed.map(focused),
      disposalEventCount: probe.disposalEvents.length,
    };
    probe.phaseMarks.push(mark);
    return mark;
  }, { cycleNumber: cycle, phaseName: phase });
}

async function readResourceLifecycleProbe(page) {
  return page.evaluate(() => {
    const probe = window.__registerResourceLifecycleProbe;
    if (!probe) return null;
    const liveAtEnd = probe.lastLive;
    const geometries = Object.values(probe.geometries).map((entry) => ({
      ...entry,
      liveAtEnd: liveAtEnd.has(entry.uuid),
      names: [...entry.names],
      kinds: [...entry.kinds],
      from: [...entry.from],
      ancestry: [...entry.ancestry],
      cycles: [...entry.cycles],
      disposeEvents: [...entry.disposeEvents],
    }));
    const ephemeralUndisposed = geometries.filter((entry) => (
      !entry.liveAtEnd
      && entry.disposeCalls === 0
      && Number(entry.firstSeen?.cycle) > 0
    ));
    const groups = new Map();
    for (const entry of ephemeralUndisposed) {
      const key = [
        entry.type,
        entry.names.join('|') || '(unnamed)',
        entry.kinds.join('|') || '(no-kind)',
        entry.from.join('|') || '(no-from)',
        entry.ancestry[0] || '(no-ancestry)',
      ].join(' :: ');
      const group = groups.get(key) || {
        signature: key,
        count: 0,
        uuids: [],
        cycles: [],
        firstSeenPhases: [],
      };
      group.count += 1;
      group.uuids.push(entry.uuid);
      for (const cycle of entry.cycles) if (!group.cycles.includes(cycle)) group.cycles.push(cycle);
      if (entry.firstSeen?.phase && !group.firstSeenPhases.includes(entry.firstSeen.phase)) {
        group.firstSeenPhases.push(entry.firstSeen.phase);
      }
      groups.set(key, group);
    }
    return {
      phaseMarks: [...probe.phaseMarks],
      disposalEvents: [...probe.disposalEvents],
      geometryCount: geometries.length,
      disposedGeometryCount: geometries.filter((entry) => entry.disposeCalls > 0).length,
      ephemeralUndisposedCount: ephemeralUndisposed.length,
      ephemeralUndisposedGroups: [...groups.values()].sort((left, right) => right.count - left.count),
      cycleGeometries: geometries.filter((entry) => (
        Number(entry.firstSeen?.cycle) > 0
        || entry.disposeEvents.some((event) => Number(event.cycle) > 0)
      )),
    };
  });
}

async function waitCamera(page, workspace, timeout = 12000) {
  await page.evaluate(() => { window.__registerLifecycleCameraProbe = null; });
  await page.waitForFunction((wanted) => {
    const app = window.__fw;
    const register = app.scene3d.clubhouse().register;
    if (register.workspace() !== wanted) return false;
    const camera = app.scene3d.camera;
    const next = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      qx: camera.quaternion.x,
      qy: camera.quaternion.y,
      qz: camera.quaternion.z,
      qw: camera.quaternion.w,
      fov: camera.fov,
    };
    const prior = window.__registerLifecycleCameraProbe;
    if (!prior) {
      window.__registerLifecycleCameraProbe = { ...next, stable: 0 };
      return false;
    }
    const delta = Math.max(
      Math.abs(next.x - prior.x), Math.abs(next.y - prior.y), Math.abs(next.z - prior.z),
      Math.abs(next.qx - prior.qx), Math.abs(next.qy - prior.qy),
      Math.abs(next.qz - prior.qz), Math.abs(next.qw - prior.qw),
      Math.abs(next.fov - prior.fov),
    );
    const stable = delta < 0.0008 ? prior.stable + 1 : 0;
    window.__registerLifecycleCameraProbe = { ...next, stable };
    return stable >= 4;
  }, workspace, { timeout, polling: 80 });
}

async function enterFrontDesk(page) {
  const alreadyActive = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
  if (!alreadyActive) await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null,
    { timeout: 8000 });
  await waitCamera(page, 'monitor');
}

async function leaveFrontDesk(page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive())) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(180);
  }
  assert(!await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive()),
    'Escape did not release the reset front desk within five normal inputs.');
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

async function clickMonitorAction(page, action, workspace) {
  await page.waitForFunction(([id, wanted]) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const point = register.monitorScreenPoint(id);
    return register.workspace() === wanted && point?.inView;
  }, [action, workspace], { timeout: 10000 });
  const point = await page.evaluate((id) => (
    window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
  ), action);
  assert(point?.inView, `Monitor action ${action} is outside the ${workspace} camera.`);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(160);
}

async function spawnCycleCustomer(page, cycle, method, skuId) {
  return page.evaluate(({ cycleNumber, paymentMethod, productSku }) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const customerList = () => (typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : clubhouse.customers);
    const prior = new Set(customerList().map((customer) => customer.customerId));
    const name = clubhouse.sendToCounter([productSku], paymentMethod);
    if (!name) throw new Error(`sendToCounter could not seed ${productSku} for cycle ${cycleNumber}.`);
    const customer = customerList().find((entry) => !prior.has(entry.customerId));
    if (!customer) throw new Error(`Cycle ${cycleNumber} customer identity was not observable.`);
    customer.__registerLifecycleCycle = cycleNumber;
    return {
      customerId: customer.customerId,
      fullName: customer.fullName || customer.name,
      method: paymentMethod,
      skuId: productSku,
    };
  }, { cycleNumber: cycle, paymentMethod: method, productSku: skuId });
}

async function waitForCycleTransaction(page, fixture) {
  await page.waitForFunction((cycle) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const owner = register.getCustomer();
    const tx = register.getTx();
    return register.isActive() && owner?.__registerLifecycleCycle === cycle
      && tx?.items?.length === 1 && tx.stage === 'scanning';
  }, fixture.cycle, { timeout: 18000 });
  return page.evaluate(({ cycle, method }) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const owner = register.getCustomer();
    const tx = register.getTx();
    if (owner?.__registerLifecycleCycle !== cycle) {
      throw new Error(`Cycle ${cycle} does not own the active transaction.`);
    }
    tx.rng = () => 0.99;
    if (method === 'cash') {
      tx.items[0].price = 5;
      tx.items[0].priceCents = 500;
    }
    return {
      number: tx.number,
      uid: tx.items[0].uid,
      startingStage: tx.stage,
      prefer: tx.prefer,
    };
  }, { cycle: fixture.cycle, method: fixture.method });
}

async function scanSingleProduct(page, uid) {
  await waitCamera(page, 'scan');
  let product = await projectObject(page, { kind: 'item', uid });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(120);
    const next = await projectObject(page, { kind: 'item', uid });
    if (next && product && Math.abs(next.x - product.x) < 1.5 && Math.abs(next.y - product.y) < 1.5) {
      product = next;
      break;
    }
    product = next;
  }
  assert(product?.inView, `Product ${uid} is outside the scan camera.`);
  await page.mouse.click(product.x, product.y);
  await page.waitForFunction((itemUid) => {
    const item = window.__fw.scene3d.clubhouse().register.getTx()?.items
      .find((entry) => entry.uid === itemUid);
    return item?.scanned && item?.staged;
  }, uid, { timeout: 9000 });
}

async function completeCard(page) {
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-ready';
  }, null, { timeout: 10000 });
  await waitCamera(page, 'card');
  const card = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  assert(card?.inView, 'The customer-held card is outside the fixed-reader camera.');
  await page.mouse.click(card.x, card.y);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-entry'
  ), null, { timeout: 5000 });
  const prefill = await page.evaluate(async () => {
    const sim = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return {
      totalCents: Math.round(sim.totalOf(tx) * 100),
      enteredCents: Number(tx.cardEntryCents),
      digits: String(tx.cardEntryDigits || ''),
    };
  });
  assert(prefill.enteredCents === prefill.totalCents
      && prefill.digits === String(prefill.totalCents),
  `Card total was not prefilled exactly: ${JSON.stringify(prefill)}.`);
  const confirm = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint('OK')
  ));
  assert(confirm?.inView, 'The fixed reader Confirm key is outside the player camera.');
  await page.mouse.click(confirm.x, confirm.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'receipt' && tx.cardResult === 'approved' && tx.cardAttempts === 1;
  }, null, { timeout: 10000 });
  return { prefill };
}

async function completeCash(page) {
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'cash-tender'
  ), null, { timeout: 10000 });
  const tender = await page.evaluate(async () => {
    const sim = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return {
      total: sim.cashTotalOf(tx),
      tendered: sim.stackTotal(tx.tendered),
      change: sim.changeDue(tx),
    };
  });
  assert(tender.total === 5 && tender.tendered === 5 && tender.change === 0,
    `Cycle exact-cash fixture is invalid: ${JSON.stringify(tender)}.`);
  const handful = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()
  ));
  assert(handful?.inView, 'The customer-held cash is outside the player camera.');
  await page.mouse.click(handful.x, handful.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'cash-drawer' && tx.drawerOpen && tx.deposited;
  }, null, { timeout: 10000 });
  await waitCamera(page, 'cash');
  const change = await page.evaluate(async () => {
    const sim = await import('/src/sim/register.js');
    return sim.changeGivingState(window.__fw.scene3d.clubhouse().register.getTx());
  });
  assert(change.state === 'exact' && change.requiredCents === 0 && change.givingCents === 0,
    `Zero change was not exact: ${JSON.stringify(change)}.`);
  await clickMonitorAction(page, 'confirm-change', 'cash');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && ['receipt', 'bagging', 'done'].includes(tx.stage)
      && !tx.drawerOpen && tx.changeGiven === 0;
  }, null, { timeout: 8000 });
  return { tender, change };
}

async function forceGarbageCollection(cdp) {
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 40));
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
}

async function snapshot(page, cdp, { cycle, phase, forceGc = true } = {}) {
  if (forceGc) {
    // Register mode maps pointer position to a bounded first-person head lean.
    // Normalize to the exact viewport centre before every cleanup sample; a
    // corner move slowly reveals previously frustum-culled shop geometry and
    // makes finite GPU realization look like a transaction leak.
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    const workspace = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.workspace()
    ));
    await waitCamera(page, workspace, 8000);
    await forceGarbageCollection(cdp);
    await page.waitForTimeout(60);
  }
  const [domCounters, runtimeHeap, performanceMetrics] = await Promise.all([
    cdp.send('Memory.getDOMCounters'),
    cdp.send('Runtime.getHeapUsage'),
    cdp.send('Performance.getMetrics'),
  ]);
  const cdpMetrics = Object.fromEntries(
    performanceMetrics.metrics.map((entry) => [entry.name, entry.value]),
  );
  const game = await page.evaluate(({ cycleNumber, samplePhase }) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const scene = app.scene3d.scene;
    const registerRoot = clubhouse.interior.getObjectByName('SimplifiedFrontDeskRegister');
    const resourceSets = (root) => {
      const geometries = new Set();
      const materials = new Set();
      const textures = new Set();
      let nodes = 0;
      let meshes = 0;
      if (!root) return { nodes, meshes, geometries: 0, materials: 0, textures: 0 };
      root.traverse((object) => {
        nodes += 1;
        if (object.isMesh) meshes += 1;
        if (object.geometry?.uuid) geometries.add(object.geometry.uuid);
        const entries = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of entries) {
          if (!material) continue;
          if (material.uuid) materials.add(material.uuid);
          for (const value of Object.values(material)) {
            if (value?.isTexture && value.uuid) textures.add(value.uuid);
          }
          for (const uniform of Object.values(material.uniforms || {})) {
            const value = uniform?.value;
            if (value?.isTexture && value.uuid) textures.add(value.uuid);
          }
        }
      });
      return {
        nodes,
        meshes,
        geometries: geometries.size,
        materials: materials.size,
        textures: textures.size,
      };
    };
    const namedCounts = {
      printedReceipts: 0,
      frontDeskBags: 0,
      visibleBagContents: 0,
      customerOwnedObjects: 0,
      customerReceiptObjects: 0,
      registerItems: 0,
      registerMoney: 0,
      registerCards: 0,
    };
    scene.traverse((object) => {
      if (object.name === 'PrintedReceipt') namedCounts.printedReceipts += 1;
      if (object.name === 'FrontDeskShoppingBag') namedCounts.frontDeskBags += 1;
      if (object.userData?.checkoutVisualState === 'visible-in-bag') {
        namedCounts.visibleBagContents += 1;
      }
      if (object.userData?.checkoutOwner === 'customer') {
        namedCounts.customerOwnedObjects += 1;
        if (/receipt/i.test(object.name || '')) namedCounts.customerReceiptObjects += 1;
      }
    });
    if (registerRoot) {
      registerRoot.traverse((object) => {
        if (object.userData?.kind === 'item') namedCounts.registerItems += 1;
        if (object.userData?.kind === 'money') namedCounts.registerMoney += 1;
        if (object.userData?.kind === 'payment-card') namedCounts.registerCards += 1;
      });
    }
    let liveDomNodes = 1;
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
    while (walker.nextNode()) liveDomNodes += 1;
    const listeners = { ...(window.__registerLifecycleProbe?.counters || {}) };
    const listenerNet = Object.values(listeners).reduce((sum, value) => sum + value, 0);
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : clubhouse.customers;
    const shop = app.state.shop;
    const renderer = app.scene3d.renderer;
    const tx = clubhouse.register.getTx();
    return {
      cycle: cycleNumber,
      phase: samplePhase,
      atMs: Math.round(performance.now()),
      state: {
        active: clubhouse.register.isActive(),
        workspace: clubhouse.register.workspace(),
        txNumber: tx?.number || null,
        txStage: tx?.stage || null,
        txMethod: tx?.method || null,
        deliveryPhase: clubhouse.register.deliveryPhase(),
        ownerCustomerId: clubhouse.register.getCustomer()?.customerId || null,
        queue: clubhouse.checkoutQueue().length,
        customers: customers.length,
        customerTransactions: customers.filter((customer) => customer.tx).length,
        customerBags: customers.filter((customer) => customer.bagMesh).length,
        customerReceipts: customers.filter((customer) => customer.bagMesh
          && customer.bagMesh.getObjectByName?.('Receipt_Strip')).length,
        units: shop.salesLive?.units || 0,
        revenue: shop.salesLive?.revenue || 0,
        history: (shop.transactionHistory || []).length,
        held: (shop.held || []).length,
        cash: app.state.cash,
      },
      scene: resourceSets(scene),
      clubhouse: resourceSets(clubhouse.interior),
      register: resourceSets(registerRoot),
      props: namedCounts,
      renderer: {
        memory: { ...renderer.info.memory },
        render: { ...renderer.info.render },
        programs: renderer.info.programs?.length ?? null,
      },
      dom: {
        liveNodes: liveDomNodes,
        bodyElements: document.body.getElementsByTagName('*').length,
      },
      listeners: { net: listenerNet, byTargetAndType: listeners },
      pageHeapBytes: performance.memory?.usedJSHeapSize ?? null,
    };
  }, { cycleNumber: cycle, samplePhase: phase });
  return {
    ...game,
    dom: {
      ...game.dom,
      documents: domCounters.documents,
      nodes: domCounters.nodes,
      jsEventListeners: domCounters.jsEventListeners,
      detachedNodesEstimate: Math.max(0, domCounters.nodes - game.dom.liveNodes),
    },
    heap: {
      pageUsedBytes: game.pageHeapBytes,
      runtimeUsedBytes: runtimeHeap.usedSize,
      runtimeTotalBytes: runtimeHeap.totalSize,
      cdpJsHeapUsedBytes: cdpMetrics.JSHeapUsedSize ?? null,
      cdpJsHeapTotalBytes: cdpMetrics.JSHeapTotalSize ?? null,
    },
  };
}

function getMetric(sample, pathSpec) {
  return pathSpec.split('.').reduce((value, key) => value?.[key], sample);
}

function metricSummary(samples, pathSpec) {
  const values = samples.map((sample) => Number(getMetric(sample, pathSpec)));
  const deltas = values.slice(1).map((value, index) => value - values[index]);
  const strictIncreases = deltas.filter((delta) => delta > 0).length;
  const monotonicLeak = deltas.length >= 3
    && deltas.every((delta) => delta >= 0)
    && strictIncreases >= Math.ceil(deltas.length / 3)
    && values[values.length - 1] > values[0];
  return {
    path: pathSpec,
    first: values[0],
    last: values[values.length - 1],
    min: Math.min(...values),
    max: Math.max(...values),
    range: Math.max(...values) - Math.min(...values),
    delta: values[values.length - 1] - values[0],
    strictIncreases,
    monotonicLeak,
    values,
  };
}

function linearSlope(values) {
  const count = values.length;
  const meanX = (count - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / count;
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY);
    denominator += (index - meanX) ** 2;
  });
  return denominator ? numerator / denominator : 0;
}

function selectTrailingStableWindow(samples) {
  const minimumSamples = samples.length >= 12 ? 5 : 3;
  const criteria = [
    ['scene.nodes', 4],
    ['clubhouse.nodes', 4],
    ['register.nodes', 4],
    ['scene.geometries', 2],
    ['scene.materials', 2],
    ['scene.textures', 2],
    ['renderer.memory.geometries', 2],
    ['renderer.memory.textures', 2],
    ['dom.liveNodes', 4],
    ['dom.nodes', 12],
    ['dom.jsEventListeners', 2],
    ['listeners.net', 0],
  ];
  const lastPossibleStart = Math.max(0, samples.length - minimumSamples);
  for (let start = 0; start <= lastPossibleStart; start += 1) {
    const candidate = samples.slice(start);
    const summaries = criteria.map(([metric]) => metricSummary(candidate, metric));
    const stable = summaries.every((summary, index) => (
      summary.range <= criteria[index][1] && !summary.monotonicLeak
    ));
    if (stable) {
      return {
        samples: candidate,
        startIndex: start,
        minimumSamples,
        selectionCriteria: Object.fromEntries(criteria),
      };
    }
  }
  return {
    samples: samples.slice(lastPossibleStart),
    startIndex: lastPossibleStart,
    minimumSamples,
    selectionCriteria: Object.fromEntries(criteria),
  };
}

function buildGates({ baseline, stableSamples, transientSamples, finalSample, cycles, fixture, tickets, diagnostics }) {
  const tolerances = {
    sceneNodesRange: 4,
    clubhouseNodesRange: 4,
    registerNodesRange: 4,
    uniqueResourceRange: 2,
    rendererMemoryRange: 2,
    liveDomNodeRange: 4,
    cdpDomNodeRange: 12,
    listenerNetRange: 0,
    jsListenerRange: 2,
    maxHeapGrowthBytes: Math.max(8 * 1024 * 1024, cycles * 512 * 1024),
    maxHeapSlopeBytesPerCycle: 512 * 1024,
  };
  const paths = [
    'scene.nodes',
    'clubhouse.nodes',
    'register.nodes',
    'scene.geometries',
    'scene.materials',
    'scene.textures',
    'renderer.memory.geometries',
    'renderer.memory.textures',
    'dom.liveNodes',
    'dom.nodes',
    'dom.jsEventListeners',
    'listeners.net',
  ];
  const summaries = Object.fromEntries(paths.map((metric) => [metric, metricSummary(stableSamples, metric)]));
  const heapValues = stableSamples.map((sample) => sample.heap.runtimeUsedBytes);
  const heap = {
    first: heapValues[0],
    last: heapValues[heapValues.length - 1],
    growthBytes: heapValues[heapValues.length - 1] - heapValues[0],
    slopeBytesPerCycle: linearSlope(heapValues),
    values: heapValues,
  };
  const checks = [];
  const check = (id, ok, actual, expected) => checks.push({ id, ok: !!ok, actual, expected });
  const rangeCheck = (metric, limit) => {
    const summary = summaries[metric];
    check(`${metric}-stable-range`, summary.range <= limit, summary.range, `<= ${limit}`);
    check(`${metric}-not-monotonic-leak`, !summary.monotonicLeak, summary, 'no repeated strict monotonic growth');
  };
  rangeCheck('scene.nodes', tolerances.sceneNodesRange);
  rangeCheck('clubhouse.nodes', tolerances.clubhouseNodesRange);
  rangeCheck('register.nodes', tolerances.registerNodesRange);
  rangeCheck('scene.geometries', tolerances.uniqueResourceRange);
  rangeCheck('scene.materials', tolerances.uniqueResourceRange);
  rangeCheck('scene.textures', tolerances.uniqueResourceRange);
  rangeCheck('renderer.memory.geometries', tolerances.rendererMemoryRange);
  rangeCheck('renderer.memory.textures', tolerances.rendererMemoryRange);
  rangeCheck('dom.liveNodes', tolerances.liveDomNodeRange);
  rangeCheck('dom.nodes', tolerances.cdpDomNodeRange);
  rangeCheck('dom.jsEventListeners', tolerances.jsListenerRange);
  rangeCheck('listeners.net', tolerances.listenerNetRange);
  check('forced-gc-heap-growth', heap.growthBytes <= tolerances.maxHeapGrowthBytes,
    heap.growthBytes, `<= ${tolerances.maxHeapGrowthBytes}`);
  check('forced-gc-heap-slope', heap.slopeBytesPerCycle <= tolerances.maxHeapSlopeBytesPerCycle,
    heap.slopeBytesPerCycle, `<= ${tolerances.maxHeapSlopeBytesPerCycle} bytes/cycle`);
  check('completed-cycle-count', tickets.length === cycles, tickets.length, cycles);
  check('units-exact-once', finalSample.state.units === fixture.units + cycles,
    finalSample.state.units - fixture.units, cycles);
  check('history-exact-once', finalSample.state.history === fixture.history + cycles,
    finalSample.state.history - fixture.history, cycles);
  check('held-reset', finalSample.state.held === fixture.held, finalSample.state.held, fixture.held);
  check('ticket-number-unique', new Set(tickets.map((ticket) => ticket.number)).size === cycles,
    tickets.map((ticket) => ticket.number), 'one unique transaction number per cycle');
  check('ticket-method-alternation', tickets.every((ticket, index) => (
    ticket.method === (index % 2 === 0 ? 'card' : 'cash')
  )), tickets.map((ticket) => ticket.method), 'card,cash alternating');
  check('receipt-observed-every-cycle', transientSamples.length === cycles
      && transientSamples.every((sample) => sample.props.printedReceipts === 1
        && sample.props.visibleBagContents === 1
        && ['receipt-print', 'receipt-ready', 'receipt-deliver'].includes(sample.state.deliveryPhase)),
  transientSamples.map((sample) => ({
    cycle: sample.cycle,
    deliveryPhase: sample.state.deliveryPhase,
    printedReceipts: sample.props.printedReceipts,
    visibleBagContents: sample.props.visibleBagContents,
  })), 'one live printed receipt and one bagged product during every handoff');
  check('post-cycle-no-live-transaction-props', stableSamples.every((sample) => (
    sample.props.printedReceipts === 0
      && sample.props.visibleBagContents === 0
      && sample.props.registerItems === 0
      && sample.props.registerCards === 0
      && sample.state.txNumber === null
      && sample.state.ownerCustomerId === null
      && sample.state.customers === 0
      && sample.state.customerTransactions === 0
      && sample.state.customerBags === 0
  )), stableSamples.map((sample) => ({
    cycle: sample.cycle,
    props: sample.props,
    customers: sample.state.customers,
    txNumber: sample.state.txNumber,
    owner: sample.state.ownerCustomerId,
  })), 'zero transient transaction/receipt/bag/customer objects after physical exit');
  check('console-errors', diagnostics.consoleErrors.length === 0,
    diagnostics.consoleErrors, []);
  check('page-errors', diagnostics.pageErrors.length === 0, diagnostics.pageErrors, []);
  check('non-aborted-request-failures', diagnostics.nonAbortedFailedRequests.length === 0,
    diagnostics.nonAbortedFailedRequests, []);
  check('front-desk-register-retained', baseline.props.frontDeskBags === 1
      && finalSample.props.frontDeskBags === 1,
  { baseline: baseline.props.frontDeskBags, final: finalSample.props.frontDeskBags },
  { baseline: 1, final: 1 });
  return {
    ok: checks.every((entry) => entry.ok),
    tolerances,
    checks,
    summaries,
    heap,
  };
}

async function addMetricsOverlay(page, result) {
  await page.evaluate((summary) => {
    document.getElementById('register-lifecycle-metrics')?.remove();
    const panel = document.createElement('div');
    panel.id = 'register-lifecycle-metrics';
    panel.style.cssText = [
      'position:fixed', 'left:24px', 'top:24px', 'z-index:2147483647',
      'width:520px', 'padding:20px 22px', 'border:2px solid #b9974e',
      'border-radius:12px', 'background:rgba(17,32,25,.94)', 'color:#f4eddb',
      'font:600 15px/1.45 Segoe UI,Arial,sans-serif',
      'box-shadow:0 18px 48px rgba(0,0,0,.42)',
    ].join(';');
    const row = (label, value) => `<div style="display:flex;justify-content:space-between;gap:16px;border-top:1px solid rgba(244,237,219,.16);padding:6px 0"><span>${label}</span><strong style="color:#d5b66f">${value}</strong></div>`;
    panel.innerHTML = `
      <div style="font:800 24px/1.1 Georgia,serif;color:#fff;margin-bottom:4px">Checkout lifecycle QA</div>
      <div style="color:#a9c5ae;margin-bottom:12px">Normal-control card/cash stress</div>
      ${row('Result', summary.ok ? 'PASS' : 'FAIL')}
      ${row('Completed sales', summary.cycles)}
      ${row('Payment route', 'card / cash alternating')}
      ${row('Units / tickets', `${summary.units} / ${summary.history}`)}
      ${row('Held inventory', summary.held)}
      ${row('Stable scene-node range', summary.sceneRange)}
      ${row('Stable geometry / texture range', `${summary.geometryRange} / ${summary.textureRange}`)}
      ${row('Listener-net range', summary.listenerRange)}
      ${row('Forced-GC heap growth', `${summary.heapGrowthMiB} MiB`)}
      ${row('Console / page errors', `${summary.consoleErrors} / ${summary.pageErrors}`)}
    `;
    document.body.appendChild(panel);
  }, result);
}

export async function runSimplifiedRegisterLifecycleStress(page, options = {}) {
  const viewport = configureViewport(options.viewport
    || process.env.REGISTER_QA_VIEWPORT
    || process.env.QA_VIEWPORT);
  const cycles = configureCycles(options.cycles || process.env.REGISTER_QA_CYCLES);
  const root = path.resolve(process.env.REGISTER_QA_ROOT
    || 'qa/cashier_master_final/lifecycle/browser');
  fs.mkdirSync(root, { recursive: true });

  const diagnostics = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    nonAbortedFailedRequests: [],
  };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(String(error?.stack || error)));
  page.on('requestfailed', (request) => diagnostics.failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || 'request failed',
  }));

  let cdp = null;
  let fixture = null;
  let baseline = null;
  const cyclesRun = [];
  const postCycleSamples = [];
  const transientSamples = [];
  const tickets = [];
  let resourceLifecycle = null;
  let currentCycle = 0;
  try {
    await boot(page);
    cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    await cdp.send('Performance.enable');
    await installListenerProbe(page);
    await installResourceLifecycleProbe(page);
    fixture = await setupFixture(page, cycles);
    await enterFrontDesk(page);
    baseline = await snapshot(page, cdp, { cycle: 0, phase: 'active-empty-baseline' });
    await markResourcePhase(page, 0, 'active-empty-baseline');

    const usage = Object.fromEntries(SKUS.map((skuId) => [skuId, 0]));
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      currentCycle = cycle;
      const method = cycle % 2 === 1 ? 'card' : 'cash';
      const skuId = SKUS[(cycle - 1) % SKUS.length];
      await markResourcePhase(page, cycle, 'pre-customer-spawn');
      const fixtureCustomer = await spawnCycleCustomer(page, cycle, method, skuId);
      fixtureCustomer.cycle = cycle;
      const tx = await waitForCycleTransaction(page, fixtureCustomer);
      await page.waitForTimeout(120);
      await markResourcePhase(page, cycle, 'transaction-ready-before-product-click');
      usage[skuId] += 1;
      await scanSingleProduct(page, tx.uid);
      const payment = method === 'card' ? await completeCard(page) : await completeCash(page);

      await page.waitForFunction(() => {
        const register = window.__fw.scene3d.clubhouse().register;
        return ['receipt-print', 'receipt-ready', 'receipt-deliver']
          .includes(register.deliveryPhase());
      }, null, { timeout: 5000, polling: 25 });
      transientSamples.push(await snapshot(page, cdp, {
        cycle,
        phase: 'receipt-and-handoff-live',
        forceGc: false,
      }));
      await markResourcePhase(page, cycle, 'receipt-and-bag-live');
      await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null,
        { timeout: 16000 });
      await page.waitForTimeout(120);
      await markResourcePhase(page, cycle, 'transaction-cleared-customer-holds-purchase');
      await page.waitForFunction((customerId) => (
        !(typeof window.__fw.scene3d.clubhouse().customers === 'function'
          ? window.__fw.scene3d.clubhouse().customers()
          : window.__fw.scene3d.clubhouse().customers)
          .some((customer) => customer.customerId === customerId)
      ), fixtureCustomer.customerId, { timeout: 22000 });
      await page.waitForTimeout(260);

      const post = await snapshot(page, cdp, { cycle, phase: 'post-customer-exit' });
      await markResourcePhase(page, cycle, 'post-customer-exit');
      postCycleSamples.push(post);
      const ticket = await page.evaluate((transactionNumber) => {
        const shop = window.__fw.state.shop;
        const found = (shop.transactionHistory || [])
          .find((entry) => Number(entry.number) === Number(transactionNumber));
        return found ? structuredClone(found) : null;
      }, tx.number);
      assert(ticket, `Cycle ${cycle} did not create transaction ticket ${tx.number}.`);
      assert(ticket.method === method && ticket.items?.length === 1,
        `Cycle ${cycle} ticket is not one ${method} item: ${JSON.stringify(ticket)}.`);
      assert(post.state.units === fixture.units + cycle,
        `Cycle ${cycle} banked ${post.state.units - fixture.units} units instead of ${cycle}.`);
      assert(post.state.history === fixture.history + cycle,
        `Cycle ${cycle} wrote ${post.state.history - fixture.history} tickets instead of ${cycle}.`);
      assert(post.state.held === fixture.held,
        `Cycle ${cycle} held inventory did not reset (${fixture.held} -> ${post.state.held}).`);
      assert(post.state.customers === 0 && post.state.txNumber === null
          && post.state.ownerCustomerId === null,
      `Cycle ${cycle} did not release its customer/transaction boundary.`);
      tickets.push(ticket);
      cyclesRun.push({
        cycle,
        method,
        skuId,
        customer: fixtureCustomer,
        transaction: tx,
        payment,
        ticket: {
          number: ticket.number,
          method: ticket.method,
          total: ticket.total,
          itemCount: ticket.items.length,
        },
        transientSampleIndex: transientSamples.length - 1,
        postCycleSampleIndex: postCycleSamples.length - 1,
      });
    }

    for (const skuId of SKUS) {
      const shelf = await page.evaluate((id) => window.__fw.state.shop.inventory[id].shelf, skuId);
      assert(shelf === fixture.shelf[skuId] - usage[skuId],
        `${skuId} shelf stock changed ${fixture.shelf[skuId] - shelf} times; expected ${usage[skuId]}.`);
    }
    const finalSample = postCycleSamples[postCycleSamples.length - 1];
    resourceLifecycle = await readResourceLifecycleProbe(page);
    diagnostics.nonAbortedFailedRequests = diagnostics.failedRequests.filter((failure) => (
      !/ERR_ABORTED|NS_BINDING_ABORTED/i.test(failure.error)
    ));
    const stableSelection = selectTrailingStableWindow(postCycleSamples);
    const stableSamples = stableSelection.samples;
    assert(stableSamples.length >= 2, 'Lifecycle run did not produce a two-sample stable window.');
    const gates = buildGates({
      baseline,
      stableSamples,
      transientSamples,
      finalSample,
      cycles,
      fixture,
      tickets,
      diagnostics,
    });
    const result = {
      ok: gates.ok,
      blocker: gates.ok ? null : {
        message: gates.checks.filter((entry) => !entry.ok)
          .map((entry) => `${entry.id}: expected ${JSON.stringify(entry.expected)}, got ${JSON.stringify(entry.actual)}`)
          .join('; '),
      },
      protocol: {
        viewport,
        deviceScaleFactor: 1,
        requestedCycles: cycles,
        completedCycles: cyclesRun.length,
        route: 'fixture customer creation only; every product, customer-held payment, fixed-reader Confirm, cash acceptance, and change confirmation uses Playwright mouse/keyboard input',
        alternation: 'odd cycles card; even cycles exact cash',
        cleanupBoundary: 'transaction cleared and the paid customer physically reached the exit/despawn before every post-cycle sample',
        baseline: 'front desk active with no transaction, no customer, and organic walk-ins disabled',
        stableWindow: {
          firstCycle: stableSamples[0].cycle,
          lastCycle: stableSamples[stableSamples.length - 1].cycle,
          sampleCount: stableSamples.length,
          minimumSamples: stableSelection.minimumSamples,
          selectionCriteria: stableSelection.selectionCriteria,
          rationale: 'earliest trailing window whose live scene, register, renderer-memory, DOM, and listener ranges meet the declared cleanup tolerances; this excludes finite lazy customer/product realization and authored drawer-stack saturation without ignoring later growth',
        },
        metrics: {
          rendererMemory: 'THREE.WebGLRenderer.info.memory',
          uniqueResources: 'UUID sets from live scene traversal',
          heap: 'CDP Runtime.getHeapUsage after two HeapProfiler.collectGarbage calls',
          domAndListeners: 'CDP Memory.getDOMCounters plus an EventTarget add/remove net probe installed before front-desk entry',
        },
      },
      fixture,
      baseline,
      cycles: cyclesRun,
      transientSamples,
      postCycleSamples,
      finalSample,
      gates,
      resourceLifecycle,
      diagnostics,
      evidence: {
        json: path.join(root, 'lifecycle-result.json'),
        screenshot: path.join(root, 'lifecycle-metrics.png'),
      },
    };
    fs.writeFileSync(result.evidence.json, `${JSON.stringify(result, null, 2)}\n`);
    await addMetricsOverlay(page, {
      ok: result.ok,
      cycles: cyclesRun.length,
      units: finalSample.state.units - fixture.units,
      history: finalSample.state.history - fixture.history,
      held: finalSample.state.held,
      sceneRange: gates.summaries['scene.nodes'].range,
      geometryRange: gates.summaries['renderer.memory.geometries'].range,
      textureRange: gates.summaries['renderer.memory.textures'].range,
      listenerRange: gates.summaries['listeners.net'].range,
      heapGrowthMiB: Math.round((gates.heap.growthBytes / (1024 * 1024)) * 100) / 100,
      consoleErrors: diagnostics.consoleErrors.length,
      pageErrors: diagnostics.pageErrors.length,
    });
    await page.screenshot({ path: result.evidence.screenshot });
    await leaveFrontDesk(page);
    return result;
  } catch (error) {
    diagnostics.nonAbortedFailedRequests = diagnostics.failedRequests.filter((failure) => (
      !/ERR_ABORTED|NS_BINDING_ABORTED/i.test(failure.error)
    ));
    resourceLifecycle = resourceLifecycle || await readResourceLifecycleProbe(page).catch(() => null);
    const failureScreenshot = path.join(root, 'lifecycle-failure.png');
    await page.screenshot({ path: failureScreenshot }).catch(() => {});
    const result = {
      ok: false,
      blocker: {
        cycle: currentCycle,
        message: error?.message || String(error),
        stack: error?.stack || null,
      },
      protocol: {
        viewport,
        requestedCycles: cycles,
        completedCycles: cyclesRun.length,
      },
      fixture,
      baseline,
      cycles: cyclesRun,
      transientSamples,
      postCycleSamples,
      resourceLifecycle,
      diagnostics,
      evidence: {
        json: path.join(root, 'lifecycle-result.json'),
        screenshot: failureScreenshot,
      },
    };
    fs.writeFileSync(result.evidence.json, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
}

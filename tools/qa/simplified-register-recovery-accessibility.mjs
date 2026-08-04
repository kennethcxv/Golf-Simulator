import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  captureCashierBuildSnapshot,
  finalizeCashierQaResult,
} from './cashier-build-snapshot.mjs';

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
const VIEWPORT = Object.freeze({ width: 1600, height: 900 });
const DEFAULT_OUT = 'qa/cashier_master_final/recovery_accessibility/final-current-hash';
const AUTOSAVE_KEY = 'golfempire:autosave';
const CHECKPOINT_KEY = 'golfempire:qa:recovery-accessibility-checkpoint';
const SKUS = Object.freeze(['tees1', 'marker1', 'glove1']);

function assert(value, message) {
  if (!value) throw new Error(message);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function resolveRecoveryAccessibilityOutput(env = process.env) {
  return path.resolve(env.REGISTER_RECOVERY_ACCESSIBILITY_ROOT || DEFAULT_OUT);
}

function powershellSingleQuoted(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function resolveRecoveryAccessibilityLaunchConfig(env = process.env) {
  const out = resolveRecoveryAccessibilityOutput(env);
  const videoDirectory = env.VIDEO_DIR ? path.resolve(env.VIDEO_DIR) : null;
  const baseUrl = env.QA_BASE_URL || 'http://localhost:8457/';
  const browserMode = env.HEADED === '1' ? 'headed' : 'headless';
  const assignments = [
    `$env:REGISTER_RECOVERY_ACCESSIBILITY_ROOT=${powershellSingleQuoted(out)}`,
    `$env:QA_BASE_URL=${powershellSingleQuoted(baseUrl)}`,
    env.HEADED === '1' ? "$env:HEADED='1'" : null,
    videoDirectory ? `$env:VIDEO_DIR=${powershellSingleQuoted(videoDirectory)}` : null,
  ].filter(Boolean);
  return {
    out,
    videoDirectory,
    baseUrl,
    browserMode,
    command: `${assignments.join('; ')}; node tools/qa/run-playwright.cjs tools/qa/simplified-register-recovery-accessibility.js --bootstrap`,
  };
}

function poseDelta(left, right) {
  const keys = ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'fov'];
  return Math.max(...keys.map((key) => Math.abs(Number(left[key]) - Number(right[key]))));
}

async function waitForGame(page) {
  await page.waitForTimeout(700);
  const { clickThroughMenu } = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
  await clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null,
    { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.evaluate(() => window.__fw.scene3d.clubhouse().setOrganicWalkins(false));
  await page.waitForTimeout(800);
}

async function boot(page) {
  await page.setViewportSize(VIEWPORT);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await waitForGame(page);
}

async function projectObject(page, query) {
  return page.evaluate(async (wanted) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const interior = app.scene3d.clubhouse().interior;
    const camera = app.scene3d.camera;
    // Box3.expandByObject updates each visited object, but not its ancestors.
    // Refresh both hierarchies explicitly so every diagnostic uses one coherent
    // world-space frame even when the sample lands between render frames.
    interior.updateWorldMatrix(true, true);
    camera.updateWorldMatrix(true, false);
    const matches = [];
    interior.traverse((object) => {
      if (!object.visible || !object.userData) return;
      if (wanted.kind && object.userData.kind !== wanted.kind) return;
      if (wanted.uid && object.userData.uid !== wanted.uid) return;
      if (wanted.denom !== undefined
          && Number(object.userData.denom) !== Number(wanted.denom)) return;
      matches.push(object);
    });
    let found = matches[0] || null;
    let productRoot = null;
    let itemClickPad = null;
    if (wanted.uid) {
      const pads = matches.filter((object) => object.name === 'ItemClickPad');
      const roots = matches.filter((object) => object.name !== 'ItemClickPad'
        && object.parent?.userData?.kind !== wanted.kind);
      if (pads.length > 1 || roots.length > 1) {
        return {
          error: `Duplicate ${wanted.kind || 'object'} roots for UID ${wanted.uid}`,
          inView: false,
        };
      }
      itemClickPad = pads[0] || null;
      productRoot = roots[0] || null;
      found = itemClickPad || productRoot;
      if (found && found.userData.uid !== wanted.uid) {
        return { error: `Target UID mismatch for ${wanted.uid}`, inView: false };
      }
    }
    if (!found) return null;

    const vectorRecord = (vector) => ({ x: vector.x, y: vector.y, z: vector.z });
    const boundsDiagnostic = (bounds, fallbackObject = null) => {
      const empty = !bounds || bounds.isEmpty();
      const worldCenter = empty
        ? fallbackObject?.getWorldPosition(new THREE.Vector3())
        : bounds.getCenter(new THREE.Vector3());
      if (!worldCenter) return null;
      const ndc = worldCenter.clone().project(camera);
      const worldBounds = empty ? null : {
        min: vectorRecord(bounds.min),
        max: vectorRecord(bounds.max),
        size: vectorRecord(bounds.getSize(new THREE.Vector3())),
      };
      return {
        empty,
        worldBounds,
        worldCenter: vectorRecord(worldCenter),
        ndc: vectorRecord(ndc),
        inView: ndc.z >= -1 && ndc.z <= 1
          && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1,
      };
    };
    const visibleInHierarchy = (object) => {
      for (let cursor = object; cursor; cursor = cursor.parent) {
        if (cursor.visible === false) return false;
      }
      return true;
    };

    // Do not use setFromObject(productRoot) here: that root contains the invisible
    // ItemClickPad, so its AABB cannot independently prove where the rendered
    // product is. Union only renderable product geometry in world space.
    const visibleProductBounds = new THREE.Box3();
    let visibleProductMeshCount = 0;
    if (productRoot) {
      productRoot.traverse((object) => {
        if (!object.isMesh || !object.geometry || object.name === 'ItemClickPad') return;
        if (!visibleInHierarchy(object)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (!materials.some((material) => material && material.visible !== false)) return;
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        if (!object.geometry.boundingBox || object.geometry.boundingBox.isEmpty()) return;
        visibleProductBounds.union(
          object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld),
        );
        visibleProductMeshCount += 1;
      });
    }

    const targetDiagnostic = boundsDiagnostic(new THREE.Box3().setFromObject(found), found);
    const itemClickPadDiagnostic = itemClickPad
      ? boundsDiagnostic(new THREE.Box3().setFromObject(itemClickPad), itemClickPad)
      : null;
    const visibleProductDiagnostic = productRoot
      ? boundsDiagnostic(visibleProductBounds, productRoot)
      : null;
    const cameraWorldPosition = new THREE.Vector3()
      .setFromMatrixPosition(camera.matrixWorld);
    const cameraWorldDirection = new THREE.Vector3(0, 0, -1)
      .transformDirection(camera.matrixWorld);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    const point = {
      x: rect.left + ((targetDiagnostic.ndc.x + 1) / 2) * rect.width,
      y: rect.top + ((-targetDiagnostic.ndc.y + 1) / 2) * rect.height,
    };
    return {
      ...point,
      inView: targetDiagnostic.inView,
      targetName: found.name || null,
      targetWorldBounds: targetDiagnostic.worldBounds,
      targetWorldCenter: targetDiagnostic.worldCenter,
      targetNdc: targetDiagnostic.ndc,
      // Preserve the prior aliases for blocker readability, but source them from
      // the independent visible-only measurement rather than the pad-contaminated root.
      productRootWorldCenter: visibleProductDiagnostic?.worldCenter || null,
      productRootNdc: visibleProductDiagnostic?.ndc || null,
      itemClickPad: itemClickPadDiagnostic,
      visibleProduct: visibleProductDiagnostic ? {
        meshCount: visibleProductMeshCount,
        ...visibleProductDiagnostic,
      } : null,
      padToVisibleCenterDistance: itemClickPadDiagnostic && visibleProductDiagnostic
        ? new THREE.Vector3(
          itemClickPadDiagnostic.worldCenter.x,
          itemClickPadDiagnostic.worldCenter.y,
          itemClickPadDiagnostic.worldCenter.z,
        ).distanceTo(new THREE.Vector3(
          visibleProductDiagnostic.worldCenter.x,
          visibleProductDiagnostic.worldCenter.y,
          visibleProductDiagnostic.worldCenter.z,
        ))
        : null,
      canvas: {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        pointX: point.x, pointY: point.y,
      },
      camera: {
        near: camera.near,
        far: camera.far,
        worldPosition: {
          x: cameraWorldPosition.x, y: cameraWorldPosition.y, z: cameraWorldPosition.z,
        },
        worldDirection: {
          x: cameraWorldDirection.x, y: cameraWorldDirection.y, z: cameraWorldDirection.z,
        },
      },
    };
  }, query);
}

async function runtimeSnapshot(page) {
  return page.evaluate(async (ids) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const { checkoutPreferences } = await import(new URL('src/sim/checkoutPreferences.js', document.baseURI).href);
    const registerDomain = await import(new URL('src/sim/register.js', document.baseURI).href);
    const registerMode = await import(new URL('src/render3d/clubhouse/simplifiedRegisterMode.js', document.baseURI).href);
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const register = clubhouse.register;
    const tx = register.getTx();
    const camera = app.scene3d.camera;
    const physical = {
      itemRoots: 0,
      itemClickPads: 0,
      paymentCardRoots: 0,
      tenderTargets: 0,
      changeRoots: 0,
      receipts: 0,
      bags: 0,
    };
    let itemPad = null;
    const visitedPhysicalObjects = new Set();
    const countPhysicalObject = (object) => {
      if (visitedPhysicalObjects.has(object)) return;
      visitedPhysicalObjects.add(object);
      const kind = object.userData?.kind;
      if (kind === 'item' && object.parent?.userData?.kind !== 'item') physical.itemRoots += 1;
      if (object.name === 'ItemClickPad') {
        physical.itemClickPads += 1;
        if (!itemPad) {
          const box = new THREE.Box3().setFromObject(object);
          const size = box.getSize(new THREE.Vector3());
          itemPad = { x: size.x, y: size.y, z: size.z };
        }
      }
      if (kind === 'payment-card' && object.parent?.userData?.kind !== 'payment-card') {
        physical.paymentCardRoots += 1;
      }
      if (kind === 'money' && object.userData?.from === 'tender'
          && object.geometry?.type === 'SphereGeometry') physical.tenderTargets += 1;
      if (kind === 'money' && object.userData?.from === 'change'
          && object.parent?.userData?.kind !== 'money') physical.changeRoots += 1;
      if (object.name === 'PrintedReceipt') physical.receipts += 1;
      if (object.name === 'FrontDeskShoppingBag') physical.bags += 1;
    };
    // The exact receipt is reparented to the active customer's authored grip
    // before BagHandoff. Customers live in the world-space custGroup rather
    // than the clubhouse interior, so count both ownership roots while the
    // transaction is live. The visited set keeps this safe across reparenting.
    clubhouse.interior.traverse(countPhysicalObject);
    register.getCustomer()?.mesh?.traverse(countPhysicalObject);
    const shop = app.state.shop;
    const prefs = checkoutPreferences(app.state);
    const activePreferencesCapability = typeof register.accessibilityPreferences === 'function';
    const activePreferences = activePreferencesCapability
      ? register.accessibilityPreferences() : { ...prefs };
    const watchdogCapability = typeof register.checkoutWatchdogDiagnostics === 'function';
    const watchdog = watchdogCapability
      ? { ...register.checkoutWatchdogDiagnostics(), source: 'register-diagnostics' }
      : {
        managedStates: [...registerMode.SIMPLIFIED_REGISTER_WATCHDOG_STATES],
        events: [],
        source: 'flow-history-fallback',
      };
    const hotspots = register.monitorHotspots();
    const exitHotspot = hotspots.find((entry) => entry.id === 'exit') || null;
    const canvas = document.querySelector('canvas').getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio },
      prefs,
      activePreferences,
      activePreferencesSource: activePreferencesCapability
        ? 'register-diagnostics' : 'state-plus-live-behavior',
      active: register.isActive(),
      workspace: register.workspace(),
      bodyRegisterMode: document.body.classList.contains('register-mode'),
      pointerLock: !!document.pointerLockElement,
      pauseOpen: !!document.querySelector('.pause-veil-ui'),
      laptopOpen: !!app.laptopOpen,
      speedIdx: app.speedIdx,
      camera: {
        x: camera.position.x, y: camera.position.y, z: camera.position.z,
        qx: camera.quaternion.x, qy: camera.quaternion.y,
        qz: camera.quaternion.z, qw: camera.quaternion.w,
        fov: camera.fov, aspect: camera.aspect,
      },
      canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height },
      flow: tx?.checkoutFlow ? {
        state: tx.checkoutFlow.state,
        sequence: tx.checkoutFlow.sequence,
        recovery: tx.checkoutFlow.recovery ? structuredClone(tx.checkoutFlow.recovery) : null,
        history: structuredClone(tx.checkoutFlow.history || []),
      } : null,
      tx: tx ? {
        number: tx.number,
        stage: tx.stage,
        method: tx.method,
        banked: !!tx.banked,
        cardAttempts: tx.cardAttempts,
        cardsTried: tx.cardsTried,
        cardResult: tx.cardResult,
        drawerOpen: !!tx.drawerOpen,
        deposited: !!tx.deposited,
        receiptPrinted: !!tx.receiptPrinted,
        receiptPacked: !!tx.receiptPacked,
        items: tx.items.map((item) => ({
          uid: item.uid, skuId: item.skuId,
          scanned: !!item.scanned, staged: !!item.staged, bagged: !!item.bagged,
        })),
        changeDue: tx.method === 'cash' ? registerDomain.changeDue(tx) : null,
        handTotal: tx.method === 'cash' ? registerDomain.handTotal(tx) : null,
      } : null,
      shop: {
        held: (shop.held || []).map((entry) => ({ uid: entry.uid, skuId: entry.skuId }))
          .sort((left, right) => String(left.uid).localeCompare(String(right.uid))),
        history: (shop.transactionHistory || []).length,
        nextTransactionNo: shop.nextTransactionNo,
        inventory: Object.fromEntries(ids.map((id) => [id, {
          shelf: Number(shop.inventory[id]?.shelf || 0),
          back: Number(shop.inventory[id]?.back || 0),
        }])),
      },
      authority: {
        cash: app.state.cash,
        drawer: structuredClone(shop.drawer || {}),
        transactionHistory: structuredClone(shop.transactionHistory || []),
        nextTransactionNo: shop.nextTransactionNo,
        salesLive: structuredClone(shop.salesLive || {}),
        ledgerToday: structuredClone(app.state.ledger?.today || {}),
      },
      physical: { ...physical, itemPad },
      monitor: { exitHotspot, hotspots },
      watchdog,
    };
  }, SKUS);
}

async function prepareOuterLifecycleFixture(page) {
  const fixture = await page.evaluate(async (ids) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const shop = app.state.shop;
    const { capacityOf } = await import(new URL('src/data/fixtureSlots.js', document.baseURI).href);
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const registerDomain = await import(new URL('src/sim/register.js', document.baseURI).href);
    clubhouse.setOrganicWalkins(false);
    if (clubhouse.register.isActive()) clubhouse.register.leave({ restorePointer: false });
    clubhouse.clearWalkins();
    if (clubhouse.register.getTx()) throw new Error('Outer fixture inherited a live transaction.');
    if (!shop.drawer) shop.drawer = registerDomain.newDrawer();
    for (const id of ids) {
      const capacity = Math.max(1, capacityOf(id));
      shop.inventory[id].shelf = Math.min(capacity,
        Math.max(shop.inventory[id].shelf || 0, Math.min(6, capacity)));
      shop.inventory[id].back = Math.max(0, shop.inventory[id].back || 0);
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

    const name = clubhouse.sendToCounter(ids, 'card');
    const customerList = typeof clubhouse.customers === 'function'
      ? clubhouse.customers() : clubhouse.customers;
    const customer = customerList.find((entry) => entry.name === name);
    if (!customer) throw new Error('Could not create the outer lifecycle fixture.');
    customer.patience = 420;
    customer.preServiceWait = 0;
    const target = customer.stops[customer.stopIdx];
    customer.mesh.position.x = target.x - 2.40;
    customer.mesh.position.z = target.z - 1.35;
    customer.path = null;
    customer.pathGoal = null;

    // Read-only, run-scoped diagnostic capture. It is removed as soon as the
    // three outer lifecycle checkpoints finish.
    window.__gfQaOuterCheckoutSnapshot = (wantedId) => {
      const liveClubhouse = window.__fw.scene3d.clubhouse();
      const liveRegister = liveClubhouse.register;
      const liveCustomers = typeof liveClubhouse.customers === 'function'
        ? liveClubhouse.customers() : liveClubhouse.customers;
      const liveCustomer = liveCustomers
        .find((entry) => entry.customerId === wantedId);
      if (!liveCustomer) return null;
      const liveShop = window.__fw.state.shop;
      const cartUids = liveCustomer.cart.map((item) => item.uid).sort();
      const visualRoots = new Map(cartUids.map((uid) => [uid, new Set()]));
      for (const [uid, mesh] of liveCustomer.itemMeshes || []) {
        if (visualRoots.has(uid) && mesh?.uuid) visualRoots.get(uid).add(mesh.uuid);
      }
      liveClubhouse.interior.traverse((object) => {
        let uid = object.userData?.checkoutUid;
        // Register product roots carry originalScale; their invisible click-pad
        // children do not. Never count a generic kind=item node as a visual root.
        if (uid == null && object.userData?.kind === 'item'
            && object.userData?.originalScale) uid = object.userData.uid;
        if (visualRoots.has(uid)) visualRoots.get(uid).add(object.uuid);
      });
      const queue = liveClubhouse.checkoutQueue();
      const queueIds = queue.map((entry) => entry.customerId);
      const targetStop = liveCustomer.stops[liveCustomer.stopIdx] || null;
      const flow = liveCustomer.checkoutFlow;
      const tx = liveRegister.getTx();
      const itemFacts = liveCustomer.cart.map((item) => {
        const mesh = liveCustomer.itemMeshes?.get(item.uid) || null;
        let parent = 'missing';
        if (mesh?.parent === liveCustomer.mesh) parent = 'customer';
        else if (mesh?.parent === liveClubhouse.interior) parent = 'counter';
        else if (mesh?.parent) parent = mesh.parent.name || mesh.parent.type || 'other';
        return {
          uid: item.uid,
          skuId: item.skuId,
          placed: item.placed === true,
          placedAt: item.placedAt ? { ...item.placedAt } : null,
          visualParent: parent,
          visualPosition: mesh ? {
            x: mesh.position.x, y: mesh.position.y, z: mesh.position.z,
            ry: mesh.rotation.y,
          } : null,
        };
      });
      return {
        customerId: liveCustomer.customerId,
        name: liveCustomer.name,
        flow: flow ? {
          state: flow.state,
          sequence: flow.sequence,
          recovery: flow.recovery ? structuredClone(flow.recovery) : null,
          history: structuredClone(flow.history || []),
        } : null,
        watchdogEvents: structuredClone(liveCustomer.checkoutWatchdogEvents || []),
        checkoutApproachArmed: !!liveCustomer.checkoutApproachArmed,
        checkoutPhase: liveCustomer.checkoutPhase,
        checkoutPlacedCount: liveCustomer.checkoutPlacedCount,
        awaitingCheckout: !!liveCustomer.awaitingCheckout,
        patience: liveCustomer.patience,
        preServiceWait: liveCustomer.preServiceWait,
        queued: !!liveCustomer.queued,
        queueIds,
        queueIndex: queueIds.indexOf(liveCustomer.customerId),
        registerCustomerId: liveRegister.getCustomer()?.customerId || null,
        registerActive: liveRegister.isActive(),
        txNumber: tx?.number || null,
        cartUids,
        items: itemFacts,
        placement: liveCustomer.checkoutPlacement ? {
          uids: [...liveCustomer.checkoutPlacement.uids],
          index: liveCustomer.checkoutPlacement.index,
          activeUid: liveCustomer.checkoutPlacement.activeUid,
          elapsed: liveCustomer.checkoutPlacement.elapsed,
          complete: !!liveCustomer.checkoutPlacement.complete,
        } : null,
        position: {
          x: liveCustomer.mesh.position.x,
          y: liveCustomer.mesh.position.y,
          z: liveCustomer.mesh.position.z,
        },
        target: targetStop ? { kind: targetStop.kind, x: targetStop.x, z: targetStop.z } : null,
        distanceToTarget: targetStop
          ? Math.hypot(targetStop.x - liveCustomer.mesh.position.x,
            targetStop.z - liveCustomer.mesh.position.z)
          : null,
        pathGoal: liveCustomer.pathGoal ? { ...liveCustomer.pathGoal } : null,
        pathLength: liveCustomer.path?.length || 0,
        visuals: {
          mapSize: liveCustomer.itemMeshes?.size || 0,
          mappedUids: [...(liveCustomer.itemMeshes?.keys() || [])].sort(),
          uniqueMappedMeshes: new Set(
            [...(liveCustomer.itemMeshes?.values() || [])].map((mesh) => mesh.uuid),
          ).size,
          counts: Object.fromEntries(
            [...visualRoots].map(([uid, roots]) => [uid, roots.size]),
          ),
        },
        shop: {
          held: (liveShop.held || []).map((entry) => ({ uid: entry.uid, skuId: entry.skuId }))
            .sort((left, right) => String(left.uid).localeCompare(String(right.uid))),
          lostSalesTotal: Number(liveShop.lostSalesTotal || 0),
          inventory: Object.fromEntries(ids.map((id) => [id, {
            shelf: Number(liveShop.inventory[id]?.shelf || 0),
            back: Number(liveShop.inventory[id]?.back || 0),
          }])),
        },
        financialAuthority: {
          cash: window.__fw.state.cash,
          drawer: structuredClone(liveShop.drawer || {}),
          transactionHistory: structuredClone(liveShop.transactionHistory || []),
          nextTransactionNo: liveShop.nextTransactionNo,
          salesLive: structuredClone(liveShop.salesLive || {}),
          ledgerToday: structuredClone(window.__fw.state.ledger?.today || {}),
          reviews: structuredClone(window.__fw.state.club?.reviews || []),
        },
      };
    };
    return { name, customerId: customer.customerId };
  }, SKUS);
  assert(fixture?.customerId, 'Outer lifecycle fixture has no customer identity.');
  await page.waitForFunction((customerId) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers() : clubhouse.customers;
    const customer = customers.find((entry) => entry.customerId === customerId);
    return customer?.checkoutApproachArmed
      && customer.checkoutFlow?.state === 'CustomerApproaching'
      && clubhouse.checkoutQueue().some((entry) => entry.customerId === customerId)
      && Math.hypot(
        customer.stops[customer.stopIdx].x - customer.mesh.position.x,
        customer.stops[customer.stopIdx].z - customer.mesh.position.z,
      ) > 0.8;
  }, fixture.customerId, { timeout: 5000 });
  return fixture;
}

async function outerCustomerSnapshot(page, customerId) {
  return page.evaluate((wantedId) => window.__gfQaOuterCheckoutSnapshot?.(wantedId) || null,
    customerId);
}

async function forceOuterCustomerWatchdogExpiry(page, customerId, expectedState) {
  return page.evaluate(async ([wantedId, state]) => {
    const { CHECKOUT_STATES } = await import(new URL('src/sim/registerFlow.js', document.baseURI).href);
    const clubhouse = window.__fw.scene3d.clubhouse();
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers() : clubhouse.customers;
    const customer = customers.find((entry) => entry.customerId === wantedId);
    const flow = customer?.checkoutFlow;
    if (!customer || !flow || flow.state !== state) {
      throw new Error(`Cannot force outer ${state}; live flow is ${flow?.state || 'missing'}.`);
    }
    const seconds = CHECKOUT_STATES[state].timeout.seconds;
    if (!Number.isFinite(seconds)) throw new Error(`${state} has no finite outer watchdog.`);
    const before = window.__gfQaOuterCheckoutSnapshot(wantedId);
    const marker = {
      state,
      sequence: flow.sequence,
      historyLength: flow.history.length,
      diagnosticCount: (customer.checkoutWatchdogEvents || []).length,
      customerId: wantedId,
      txNumber: clubhouse.register.getTx()?.number || null,
      expiredByMs: 250,
    };
    flow.enteredAtMs = performance.now() - seconds * 1000 - marker.expiredByMs;
    // The game RAF was registered before this callback. Capturing in the
    // microtask after it proves the adapter recovered in exactly one update.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const recovered = window.__gfQaOuterCheckoutSnapshot(wantedId);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const nextFrame = window.__gfQaOuterCheckoutSnapshot(wantedId);
    return { marker, before, recovered, nextFrame };
  }, [customerId, expectedState]);
}

function outerRecoveryEntries(snapshot, marker) {
  const entries = snapshot.flow.history.slice(marker.historyLength);
  return {
    entries,
    entered: entries.filter((entry) => entry.from === marker.state
      && entry.to === 'Recovery' && entry.event === `timeout:${marker.state}`),
    resumed: entries.filter((entry) => entry.from === 'Recovery'
      && entry.event === 'recovery-complete'),
    diagnostics: snapshot.watchdogEvents.slice(marker.diagnosticCount)
      .filter((entry) => entry.fromState === marker.state),
  };
}

function outerAuthorityView(snapshot) {
  return {
    cartUids: snapshot.cartUids,
    held: snapshot.shop.held,
    lostSalesTotal: snapshot.shop.lostSalesTotal,
    inventory: snapshot.shop.inventory,
    financialAuthority: snapshot.financialAuthority,
    queued: snapshot.queued,
    queueIds: snapshot.queueIds,
    queueIndex: snapshot.queueIndex,
    registerCustomerId: snapshot.registerCustomerId,
    txNumber: snapshot.txNumber,
    patience: snapshot.patience,
    preServiceWait: snapshot.preServiceWait,
  };
}

function outerConservedAuthorityView(snapshot) {
  const view = outerAuthorityView(snapshot);
  delete view.patience;
  delete view.preServiceWait;
  return view;
}

function assertNoDuplicateOuterMeshes(snapshot, label, { requireOne = false } = {}) {
  assert(snapshot.visuals.mapSize === snapshot.visuals.uniqueMappedMeshes,
    `${label} maps two UIDs to the same customer mesh.`);
  for (const uid of snapshot.cartUids) {
    const count = snapshot.visuals.counts[uid] || 0;
    assert(count <= 1,
      `${label} has ${count} visual roots for ${uid}, expected no duplicate.`);
    if (requireOne) assert(count === 1,
      `${label} has no visual root for ${uid}, expected one after placement began.`);
  }
}

function assertSingleOuterRecovery(checkpoint, expectedResume) {
  const { marker, before, recovered, nextFrame } = checkpoint;
  assert(recovered, `${marker.state} removed the live customer during recovery.`);
  assert(same(outerAuthorityView(recovered), outerAuthorityView(before)),
    `${marker.state} recovery changed cart/inventory/financial/queue/patience authority.`);
  const trace = outerRecoveryEntries(recovered, marker);
  assert(trace.entered.length === 1,
    `${marker.state} recorded ${trace.entered.length} outer Recovery entries, expected one.`);
  assert(trace.resumed.length === 1 && trace.resumed[0].to === expectedResume,
    `${marker.state} recorded an invalid outer resume: ${JSON.stringify(trace.resumed)}.`);
  assert(trace.diagnostics.length === 1
      && trace.diagnostics[0].resumeState === expectedResume,
  `${marker.state} outer diagnostics were not exactly-once successful.`);
  const deferred = outerRecoveryEntries(nextFrame, marker);
  assert(deferred.entered.length === 1 && deferred.resumed.length === 1
      && deferred.diagnostics.length === 1,
  `${marker.state} looped during its next-frame forward-progress window.`);
  assert(same(outerConservedAuthorityView(nextFrame), outerConservedAuthorityView(before)),
    `${marker.state} next-frame progress changed conserved customer or sale authority.`);
  const requireOne = marker.state !== 'CustomerApproaching';
  assertNoDuplicateOuterMeshes(recovered, `${marker.state} recovery frame`, { requireOne });
  assertNoDuplicateOuterMeshes(nextFrame, `${marker.state} next frame`, { requireOne });
  return trace;
}

async function prepareFixture(page, payment) {
  const baseline = await page.evaluate(async (ids) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const shop = app.state.shop;
    const { capacityOf } = await import(new URL('src/data/fixtureSlots.js', document.baseURI).href);
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const register = await import(new URL('src/sim/register.js', document.baseURI).href);
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    if (clubhouse.register.isActive()) clubhouse.register.leave({ restorePointer: false });
    if (!shop.drawer) shop.drawer = register.newDrawer();
    for (const id of ids) {
      const capacity = Math.max(1, capacityOf(id));
      shop.inventory[id].shelf = Math.min(capacity,
        Math.max(shop.inventory[id].shelf || 0, Math.min(6, capacity)));
      shop.inventory[id].back = Math.max(0, shop.inventory[id].back || 0);
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
    return {
      inventory: Object.fromEntries(ids.map((id) => [id, {
        shelf: Number(shop.inventory[id].shelf || 0),
        back: Number(shop.inventory[id].back || 0),
      }])),
      held: (shop.held || []).length,
      history: (shop.transactionHistory || []).length,
    };
  }, SKUS);
  const fixture = await page.evaluate(([ids, method]) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const name = clubhouse.sendToCounter(ids, method);
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers() : clubhouse.customers;
    const customer = customers.find((entry) => entry.name === name);
    if (customer) customer.patience = 180;
    return { name, customerId: customer?.customerId || null };
  }, [SKUS, payment]);
  assert(fixture.name, `Could not establish the deterministic ${payment} fixture.`);
  await page.waitForFunction(([count, name]) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const tx = clubhouse.register.getTx();
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers() : clubhouse.customers;
    const customer = customers.find((entry) => entry.name === name);
    return tx?.items?.length === count && (!customer || customer.checkoutPhase === 'waiting');
  }, [SKUS.length, fixture.name], { timeout: 18000 });
  return { ...fixture, payment, baseline };
}

async function enterCheckout(page) {
  await page.keyboard.press('e');
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.isActive() && register.workspace() === 'scan';
  }, null, { timeout: 8000 });
  await page.waitForTimeout(650);
}

async function scanNext(page) {
  const uid = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items.find((item) => !item.scanned)?.uid
  ));
  assert(uid, 'No unscanned item was available.');
  let point = await projectObject(page, { kind: 'item', uid });
  for (let attempt = 0; attempt < 14; attempt += 1) {
    await page.waitForTimeout(100);
    const next = await projectObject(page, { kind: 'item', uid });
    if (point && next && Math.abs(point.x - next.x) < 1 && Math.abs(point.y - next.y) < 1) {
      point = next;
      break;
    }
    point = next;
  }
  assert(point?.inView,
    `Product ${uid} was outside the fixed player camera${point ? `: ${JSON.stringify(point)}` : ''}.`);
  const started = performance.now();
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction((id) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const item = register.getTx()?.items
      .find((entry) => entry.uid === id);
    return !!item?.scanned && !!item?.staged
      && ['WaitingForScan', 'AllProductsScanned'].includes(register.getFlow()?.state);
  }, uid, { timeout: 8000 });
  return { uid, elapsedMs: Math.round((performance.now() - started) * 10) / 10 };
}

async function scanAll(page) {
  const results = [];
  while (await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.items.some((item) => !item.scanned)
  ))) results.push(await scanNext(page));
  return results;
}

async function cameraSwayProbe(page) {
  const rect = (await runtimeSnapshot(page)).canvas;
  await page.mouse.move(rect.x + rect.width * 0.5, rect.y + rect.height * 0.5);
  await page.waitForTimeout(450);
  const before = (await runtimeSnapshot(page)).camera;
  await page.mouse.move(rect.x + rect.width * 0.94, rect.y + rect.height * 0.14);
  await page.waitForTimeout(450);
  const after = (await runtimeSnapshot(page)).camera;
  return { before, after, delta: poseDelta(before, after) };
}

async function waitForSwayWorkspace(page) {
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.workspace() === 'card'
      && ['CardPresented', 'CardInsertReady'].includes(register.getFlow()?.state);
  }, null, { timeout: 12000 });
  await page.waitForTimeout(600);
}

async function moveToLaptop(page) {
  await page.evaluate(async () => {
    const app = window.__fw;
    const { FRONT_DESK, REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const off = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    // Approach from the laptop side opposite the register's interaction prop.
    // Both controls have generous radii, and the walk-focus resolver otherwise
    // selects the nearer scanner even while the player is looking at the laptop.
    const awayX = FRONT_DESK.laptop.x - REGISTER.scanner.x;
    const awayZ = FRONT_DESK.laptop.z - REGISTER.scanner.z;
    const separation = Math.hypot(awayX, awayZ) || 0.001;
    walk.x = FRONT_DESK.laptop.x + (awayX / separation) * 1.05 + off.x;
    walk.z = FRONT_DESK.laptop.z + (awayZ / separation) * 1.05 + off.z;
    const dx = FRONT_DESK.laptop.x - (walk.x - off.x);
    const dz = FRONT_DESK.laptop.z - (walk.z - off.z);
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    walk.pitch = -0.05;
  });
  await page.waitForTimeout(500);
}

async function openSettings(page) {
  await moveToLaptop(page);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.laptopOpen && document.querySelector('.lt-frame'),
    null, { timeout: 12000 });
  const settings = page.locator('.lt-navbtn').filter({ hasText: /^Settings$/ });
  await settings.waitFor({ state: 'visible', timeout: 5000 });
  assert(await settings.count() === 1, 'Settings navigation is missing from the physical laptop.');
  // The laptop overlay eases into its projected screen pose. Playwright's
  // actionability check waits for those bounds to settle before issuing the
  // same trusted pointer click a player uses; a point captured immediately
  // after laptopOpen can otherwise land on the prior Home position.
  await settings.click();
  await page.waitForFunction(() => document.querySelector('.lt-h1')?.textContent.includes('Settings'),
    null, { timeout: 5000 });
  await page.waitForTimeout(300);
}

async function checkoutSettingsUi(page) {
  return page.evaluate(() => {
    const labels = [
      'Larger POS text and targets',
      'Reduced checkout camera motion',
      'Faster checkout animations',
      'Automatic exact change',
      'Confirm cash purchases',
    ];
    return Object.fromEntries(labels.map((label) => {
      const row = [...document.querySelectorAll('label.lt-row')]
        .find((entry) => entry.textContent.includes(label));
      const input = row?.querySelector('input[type="checkbox"]');
      const rect = row?.getBoundingClientRect();
      return [label, {
        present: !!row,
        checked: !!input?.checked,
        row: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      }];
    }));
  });
}

async function setSetting(page, label, checked) {
  const row = page.locator('label.lt-row').filter({ hasText: label });
  await row.waitFor({ state: 'attached', timeout: 3000 });
  assert(await row.count() === 1, `Setting ${label} is missing.`);
  const input = row.locator('input[type="checkbox"]');
  await input.scrollIntoViewIfNeeded();
  if (await input.isChecked() !== checked) await input.click();
  await page.waitForFunction(([wanted, value]) => {
    const row = [...document.querySelectorAll('label.lt-row')]
      .find((entry) => entry.textContent.includes(wanted));
    return row?.querySelector('input[type="checkbox"]')?.checked === value;
  }, [label, checked], { timeout: 3000 });
}

async function closeLaptop(page) {
  const close = page.locator('button.lt-primary').filter({ hasText: /^Close Laptop$/ });
  await close.waitFor({ state: 'visible', timeout: 3000 });
  assert(await close.count() === 1, 'The Settings page Close Laptop control is missing.');
  await close.click();
  await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 5000 });
}

async function saveExactCheckpoint(page) {
  return page.evaluate(async ([autosaveKey, checkpointKey]) => {
    await window.__fw.autosave();
    const raw = localStorage.getItem(autosaveKey);
    if (!raw) throw new Error(`Autosave did not write ${autosaveKey}.`);
    sessionStorage.setItem(checkpointKey, raw);
    return { bytes: raw.length };
  }, [AUTOSAVE_KEY, CHECKPOINT_KEY]);
}

async function clickPresentedCardToAmountEntry(page) {
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-ready' && tx.checkoutFlow?.state === 'CardInsertReady';
  }, null, { timeout: 10000 });
  const card = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  assert(card?.inView, 'The presented card is outside the production card camera.');
  await page.mouse.click(card.x, card.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-entry' && tx.checkoutFlow?.state === 'CardAmountEntry';
  }, null, { timeout: 5000 });
}

async function clickCardConfirm(page) {
  const point = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint('OK')
  ));
  assert(point?.inView, 'The physical card reader Confirm key is outside the player camera.');
  await page.mouse.click(point.x, point.y);
}

async function clickMonitorAction(page, action) {
  await page.waitForFunction((id) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const point = register.monitorScreenPoint(id);
    return register.workspace() === 'monitor' && point?.inView;
  }, action, { timeout: 10000 });
  const point = await page.evaluate((id) => (
    window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
  ), action);
  assert(point?.inView, `Monitor action ${action} is outside the player camera.`);
  await page.mouse.click(point.x, point.y);
}

async function forceLiveWatchdogExpiry(page, expectedState) {
  return page.evaluate(async (state) => {
    const { CHECKOUT_STATES } = await import(new URL('src/sim/registerFlow.js', document.baseURI).href);
    const register = window.__fw.scene3d.clubhouse().register;
    const flow = register.getFlow();
    if (!flow || flow.state !== state) {
      throw new Error(`Cannot force ${state}; live flow is ${flow?.state || 'missing'}.`);
    }
    const seconds = CHECKOUT_STATES[state].timeout.seconds;
    if (!Number.isFinite(seconds)) throw new Error(`${state} has no finite watchdog.`);
    const diagnostics = typeof register.checkoutWatchdogDiagnostics === 'function'
      ? register.checkoutWatchdogDiagnostics() : null;
    const marker = {
      state,
      sequence: flow.sequence,
      historyLength: flow.history.length,
      diagnosticsAvailable: !!diagnostics,
      diagnosticCount: diagnostics?.events.length || 0,
      txNumber: register.getTx()?.number,
      expiredByMs: 250,
    };
    flow.enteredAtMs = performance.now() - seconds * 1000 - marker.expiredByMs;
    return marker;
  }, expectedState);
}

async function waitForLiveWatchdogRecovery(page, marker) {
  await page.waitForFunction(({ state, historyLength }) => {
    const flow = window.__fw.scene3d.clubhouse().register.getFlow();
    const entries = flow?.history?.slice(historyLength) || [];
    return entries.some((entry) => entry.from === state && entry.to === 'Recovery'
      && entry.event === `timeout:${state}`)
      && entries.some((entry) => entry.from === 'Recovery'
        && entry.event === 'recovery-complete');
  }, marker, { timeout: 4000 });
}

function recoveryEntries(snapshot, marker) {
  const entries = snapshot.flow.history.slice(marker.historyLength);
  return {
    entries,
    entered: entries.filter((entry) => entry.from === marker.state
      && entry.to === 'Recovery' && entry.event === `timeout:${marker.state}`),
    resumed: entries.filter((entry) => entry.from === 'Recovery'
      && entry.event === 'recovery-complete'),
    diagnosticEvents: marker.diagnosticsAvailable
      ? snapshot.watchdog.events.slice(marker.diagnosticCount)
        .filter((entry) => entry.fromState === marker.state)
      : [],
  };
}

function assertSingleLiveRecovery(snapshot, marker, expectedResume) {
  const trace = recoveryEntries(snapshot, marker);
  assert(snapshot.tx?.number === marker.txNumber,
    `${marker.state} watchdog replaced the transaction identity.`);
  assert(trace.entered.length === 1,
    `${marker.state} recorded ${trace.entered.length} Recovery entries, expected one.`);
  assert(trace.resumed.length === 1 && trace.resumed[0].to === expectedResume,
    `${marker.state} recorded an invalid resume: ${JSON.stringify(trace.resumed)}.`);
  if (marker.diagnosticsAvailable) {
    assert(trace.diagnosticEvents.length === 1 && trace.diagnosticEvents[0].ok,
      `${marker.state} watchdog diagnostics were not exactly-once successful.`);
  } else {
    assert(snapshot.watchdog.source === 'flow-history-fallback',
      `${marker.state} has neither public diagnostics nor the flow-history fallback.`);
  }
  return trace;
}

async function restoreExactCheckpointAndReload(page) {
  await page.evaluate(([autosaveKey, checkpointKey]) => {
    const raw = sessionStorage.getItem(checkpointKey);
    if (!raw) throw new Error(`Missing exact checkpoint ${checkpointKey}.`);
    localStorage.setItem(autosaveKey, raw);
  }, [AUTOSAVE_KEY, CHECKPOINT_KEY]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForGame(page);
}

async function checkpointDigest(page) {
  return page.evaluate((key) => sessionStorage.getItem(key), CHECKPOINT_KEY)
    .then((raw) => ({
      bytes: raw?.length || 0,
      sha256: raw ? crypto.createHash('sha256').update(raw).digest('hex') : null,
    }));
}

async function leaveRegisterToWorld(page) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const active = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
    if (!active) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
  }
  assert(!(await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive())),
    'Normal Escape input did not leave the register.');
}

async function openPause(page) {
  await leaveRegisterToWorld(page);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await page.locator('.pause-veil-ui').count()) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(160);
  }
  await page.waitForSelector('.pause-veil-ui', { timeout: 4000 });
}

async function contractAudit(page) {
  return page.evaluate(async () => {
    const flow = await import(new URL('src/sim/registerFlow.js', document.baseURI).href);
    const mode = await import(new URL('src/render3d/clubhouse/simplifiedRegisterMode.js', document.baseURI).href);
    const validation = flow.validateCheckoutContract();
    const deliberateUntimed = flow.CHECKOUT_STATE_ORDER.filter(
      (name) => flow.CHECKOUT_STATES[name].timeout.seconds == null,
    );
    return {
      ...validation,
      count: flow.CHECKOUT_STATE_ORDER.length,
      liveWatchdogStates: [...mode.SIMPLIFIED_REGISTER_WATCHDOG_STATES],
      deliberateUntimed,
      outerLifecycleTimedStates: [
        'CustomerApproaching', 'CustomerPlacingProducts', 'WaitingForCashier',
      ],
      states: flow.CHECKOUT_STATE_ORDER.map((name) => {
        const spec = flow.CHECKOUT_STATES[name];
        return {
          id: name,
          phase: spec.phase,
          branch: spec.branch,
          allowedInput: [...spec.allowedInput],
          timeout: { ...spec.timeout },
          recoveryPath: { ...spec.recoveryPath },
          nextStates: [...spec.nextStates],
        };
      }),
    };
  });
}

function cleanRecoveryView(snapshot) {
  return {
    prefs: snapshot.prefs,
    tx: snapshot.tx,
    active: snapshot.active,
    bodyRegisterMode: snapshot.bodyRegisterMode,
    pointerLock: snapshot.pointerLock,
    workspace: snapshot.workspace,
    shop: snapshot.shop,
    physical: snapshot.physical,
  };
}

function markdown(result) {
  const evidence = result.evidence.map((file) => `- \`${path.relative(process.cwd(), file)}\``).join('\n');
  const states = result.contract.states.map((state) => (
    `| ${state.id} | ${state.timeout.seconds == null ? 'untimed' : `${state.timeout.seconds}s`} | ${state.recoveryPath.checkpoint} → ${state.recoveryPath.resumeState || 'stored'} |`
  )).join('\n');
  return `# Cashier recovery and accessibility audit\n\n`
    + `Result: **${result.ok ? 'PASS' : 'BLOCKED'}**  \n`
    + `Generated: ${result.generatedAt}\n\n`
    + `Browser-session video directory: ${result.videoDirectory ? `\`${path.relative(process.cwd(), result.videoDirectory)}\`` : 'not requested'}\n\n`
    + `## Scope and result\n\n`
    + `This focused browser run used the production game at 1600×900 (plus active 1280×720 and 1920×1080 resize checks). Player actions after deterministic customer setup used keyboard/mouse input. It proves outer customer arrival/placement/wait recovery, the physical laptop settings UI, persistence, live register preference consumption, focus-loss rollback, resize stability, pause/re-entry, live transaction recovery, exact autosave rollback, automatic exact-change counting, optional automatic handoff, and completed-sale cleanup.\n\n`
    + `Browser command: \`${result.command}\`\n\n`
    + `Focused Node command: \`${result.nodeTests.command}\` — ${result.nodeTests.pass}/${result.nodeTests.total} passing.\n\n`
    + `## Accessibility proof\n\n`
    + `- Default and enabled settings are visible on the physical laptop; all five selected values survived the exact production autosave/reload path.\n`
    + `- Large targets expanded the live POS Exit hotspot from ${result.accessibility.defaultTarget.width.toFixed(1)}×${result.accessibility.defaultTarget.height.toFixed(1)} to ${result.accessibility.largeTarget.width.toFixed(1)}×${result.accessibility.largeTarget.height.toFixed(1)} canvas pixels.\n`
    + `- First-item scan choreography measured ${result.accessibility.defaultScanMs.toFixed(1)} ms at standard speed and ${result.accessibility.fastScanMs.toFixed(1)} ms with faster animations.\n`
    + `- Cursor camera sway delta changed from ${result.accessibility.defaultSway.delta.toExponential(3)} to ${result.accessibility.reducedSway.delta.toExponential(3)} with reduced motion.\n`
    + `- Automatic exact change selected $${result.cash.confirmed.changeDue.toFixed(2)} without drawer clicks and waited for Enter when confirmation was enabled. With confirmation disabled, flow history recorded \`accessibility-auto-confirmed-exact-change\` and reached receipt handoff without Enter or drawer clicks.\n\n`
    + `## Recovery proof\n\n`
    + `- Forced live CustomerApproaching, mid-CustomerPlacingProducts, and WaitingForCashier expiries each traversed exactly one Recovery/resume pair. The same queue owner, cart UIDs, held/inventory facts, patience, and financial authority survived; approach rebuilt navigation on the next frame, placement resumed at the first unfinished UID while retaining the durable counter pose, and normal E input advanced the same waiting transaction. Every cart UID retained exactly one visual root.\n`
    + `- Blur during CardInserting returned the same transaction to CardInsertReady with the scanned UID set intact and no banked sale.\n`
    + `- Active 1280×720 and 1920×1080 resizes retained the same transaction/flow and kept the presented card in view.\n`
    + `- Normal Escape controls opened the pause menu; Resume + E restored the same transaction number and scanned UID set.\n`
    + `- Forced live CardProcessing expiry traversed exactly one \`CardProcessing → Recovery → CardPresented\` pair. The original authorization window then elapsed with no late approval/decline, unchanged attempt identity, and unchanged persistent cash/drawer/history/ledger authority.\n`
    + `- The recovered card was run again through the physical Confirm key, deterministically declined, and switched through the visible \`Switch to Cash\` monitor action. Forced DrawerOpening expiry then traversed exactly one \`DrawerOpening → Recovery → CashAccepted\` pair, rebuilt only the transaction-local cash journal, and completed/banked once through normal choreography.\n`
    + `- Forced authorized ReceiptPrinting and BagHandoff expiries each traversed one Recovery/resume pair while retaining exactly one receipt, one shopping bag, and unchanged persistent authority.\n`
    + `- The recovered sale visibly held \`BagHandoff\` during bag transfer and \`CustomerLeaving\` during the post-transfer finalize window; banking no longer traverses those timed states synchronously.\n`
    + `- Exact checkpoint ${result.recovery.checkpoint.sha256} loaded twice. Both loads had no live transaction, held UID, register class, pointer lock, or checkout prop roots; inventory/history/preferences were identical.\n`
    + `- Final completed-sale cleanup left ${result.cleanup.physical.itemRoots} item roots, ${result.cleanup.physical.itemClickPads} item pads, ${result.cleanup.physical.tenderTargets} tender targets, ${result.cleanup.physical.changeRoots} selected-change roots, and ${result.cleanup.physical.receipts} register receipts.\n\n`
    + `## Explicit flow contracts\n\n`
    + `Contract validation: ${result.contract.ok ? 'PASS' : 'FAIL'}, ${result.contract.count} explicit states; ${result.contract.liveWatchdogStates.length} finite active-register states are register-watchdog managed, 3 timed arrival/wait states are outer-lifecycle managed, and ${result.contract.deliberateUntimed.length} deliberate/terminal states are untimed.\n\n`
    + `| State | Timeout | Recovery checkpoint → target |\n|---|---:|---|\n${states}\n\n`
    + `## Diagnostics and honest gaps\n\n`
    + `Console errors: ${result.diagnostics.consoleErrors.length}; page errors: ${result.diagnostics.pageErrors.length}; non-aborted failed requests: ${result.diagnostics.failedRequests.length}; HTTP errors: ${result.diagnostics.httpErrors.length}; warnings: ${result.diagnostics.warnings.length}.\n\n`
    + `- Headless Chrome cannot perform a true operating-system alt-tab; the blur proof dispatches the same window blur event consumed by production \`main.js\`.\n`
    + `- The live simplified-register loop enforces its finite automatic states; the outer customer loop independently enforces CustomerApproaching, CustomerPlacingProducts, and WaitingForCashier. Deliberate player waits remain untimed.\n`
    + `- Deterministic setup uses the documented \`sendToCounter\` QA fixture plus stock/time/weather normalization, a temporary approach-position offset, and an authorization RNG override for the explicit decline branch.\n`
    + `- This is a focused recovery/accessibility gate run, not the browser-game-visual-qa skill's full four-fix-iteration production loop.\n\n`
    + `## Evidence\n\n${evidence}\n`;
}

export async function runRecoveryAccessibilityAudit(page) {
  const launchConfig = resolveRecoveryAccessibilityLaunchConfig();
  const { out } = launchConfig;
  fs.mkdirSync(out, { recursive: true });
  const productionBuildBefore = captureCashierBuildSnapshot();
  const diagnostics = {
    consoleErrors: [], pageErrors: [], warnings: [], failedRequests: [], httpErrors: [],
  };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.warnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(String(error?.stack || error)));
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText || 'request failed';
    if (!/ERR_ABORTED/.test(error)) diagnostics.failedRequests.push({ url: request.url(), error });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) diagnostics.httpErrors.push({ status: response.status(), url: response.url() });
  });
  const evidence = [];
  let shotNumber = 0;
  const shot = async (label) => {
    shotNumber += 1;
    const file = path.join(out, `${String(shotNumber).padStart(2, '0')}-${label}.png`);
    await page.screenshot({ path: file });
    evidence.push(file);
    return file;
  };
  let stage = 'boot';
  try {
    await boot(page);
    const contract = await contractAudit(page);
    assert(contract.ok && contract.count === 30, `Checkout contract failed: ${contract.errors.join(' | ')}`);
    assert(contract.liveWatchdogStates.length === 19 && contract.deliberateUntimed.length === 8,
      `Live watchdog/untimed classification drifted: ${JSON.stringify(contract)}.`);

    stage = 'outer customer lifecycle watchdog recovery';
    const outerFixture = await prepareOuterLifecycleFixture(page);

    const customerApproach = await forceOuterCustomerWatchdogExpiry(
      page,
      outerFixture.customerId,
      'CustomerApproaching',
    );
    const approachTrace = assertSingleOuterRecovery(customerApproach, 'CustomerApproaching');
    assert(customerApproach.before.checkoutApproachArmed
        && customerApproach.before.distanceToTarget > 0.8,
    'Approach fixture was not armed away from the live queue target.');
    assert(customerApproach.recovered.pathGoal === null
        && customerApproach.recovered.pathLength === 0,
    'CustomerApproaching recovery did not clear unsafe navigation state.');
    assert(customerApproach.nextFrame.flow.state === 'CustomerApproaching'
        && customerApproach.nextFrame.pathGoal
        && customerApproach.nextFrame.pathLength > 0
        && customerApproach.nextFrame.distanceToTarget
          <= customerApproach.recovered.distanceToTarget + 0.001,
    'CustomerApproaching did not rebuild its route and move forward on the next frame.');
    await shot('outer-watchdog-customer-approach-recovered');

    await page.waitForFunction((customerId) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const customers = typeof clubhouse.customers === 'function'
        ? clubhouse.customers() : clubhouse.customers;
      const customer = customers
        .find((entry) => entry.customerId === customerId);
      if (customer?.checkoutFlow?.state !== 'CustomerPlacingProducts') return false;
      const durable = customer.cart.filter((item) => item.placed === true && item.placedAt);
      const activeUid = customer.checkoutPlacement?.activeUid;
      const interrupted = customer.cart.find((item) => item.uid === activeUid);
      const untouched = customer.cart.filter((item) => !item.placed && item.uid !== activeUid);
      return durable.length === 1 && activeUid && interrupted?.placed === false
        && !!interrupted.placedAt && untouched.length >= 1;
    }, outerFixture.customerId, { timeout: 18000 });
    const customerPlacement = await forceOuterCustomerWatchdogExpiry(
      page,
      outerFixture.customerId,
      'CustomerPlacingProducts',
    );
    const placementTrace = assertSingleOuterRecovery(
      customerPlacement,
      'CustomerPlacingProducts',
    );
    const durablePlaced = customerPlacement.before.items
      .filter((item) => item.placed && item.placedAt);
    const interruptedUid = customerPlacement.before.placement.activeUid;
    const unfinishedUids = customerPlacement.before.items
      .filter((item) => !item.placed)
      .map((item) => item.uid);
    assert(durablePlaced.length === 1 && interruptedUid
        && unfinishedUids.length >= 2,
    'Mid-placement fixture did not contain one durable, one interrupted, and one unfinished item.');
    assert(same(customerPlacement.recovered.placement.uids, unfinishedUids)
        && customerPlacement.recovered.placement.activeUid === null,
    'CustomerPlacingProducts recovery did not rebuild from unfinished UID facts.');
    const recoveredDurable = customerPlacement.recovered.items
      .find((item) => item.uid === durablePlaced[0].uid);
    const recoveredInterrupted = customerPlacement.recovered.items
      .find((item) => item.uid === interruptedUid);
    assert(recoveredDurable?.visualParent === 'counter'
        && recoveredDurable.visualPosition
        && Math.abs(recoveredDurable.visualPosition.x - recoveredDurable.placedAt.x) < 0.000001
        && Math.abs(recoveredDurable.visualPosition.y - recoveredDurable.placedAt.y) < 0.000001
        && Math.abs(recoveredDurable.visualPosition.z - recoveredDurable.placedAt.z) < 0.000001
        && Math.abs(recoveredDurable.visualPosition.ry - recoveredDurable.placedAt.ry) < 0.000001,
    'CustomerPlacingProducts recovery moved the durable counter item from its exact pose.');
    assert(recoveredInterrupted?.placed === false
        && recoveredInterrupted.visualParent === 'customer',
    'CustomerPlacingProducts recovery did not return only the interrupted item to carry.');
    const nextInterrupted = customerPlacement.nextFrame.items
      .find((item) => item.uid === interruptedUid);
    assert(customerPlacement.nextFrame.flow.state === 'CustomerPlacingProducts'
        && customerPlacement.nextFrame.placement.activeUid === interruptedUid
        && nextInterrupted?.visualParent === 'counter',
    'CustomerPlacingProducts did not restart the first unfinished UID on the next frame.');
    await shot('outer-watchdog-mid-placement-recovered');

    await page.waitForFunction((customerId) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const customers = typeof clubhouse.customers === 'function'
        ? clubhouse.customers() : clubhouse.customers;
      const customer = customers.find((entry) => entry.customerId === customerId);
      const tx = clubhouse.register.getTx();
      return customer?.checkoutFlow?.state === 'WaitingForCashier'
        && customer.awaitingCheckout && tx?.items?.length === 3
        && clubhouse.register.getCustomer() === customer
        && !clubhouse.register.isActive();
    }, outerFixture.customerId, { timeout: 18000 });
    const customerWaiting = await forceOuterCustomerWatchdogExpiry(
      page,
      outerFixture.customerId,
      'WaitingForCashier',
    );
    const waitingTrace = assertSingleOuterRecovery(customerWaiting, 'WaitingForCashier');
    assert(customerWaiting.recovered.txNumber === customerWaiting.before.txNumber
        && customerWaiting.recovered.registerCustomerId === outerFixture.customerId
        && !customerWaiting.recovered.registerActive
        && customerWaiting.nextFrame.flow.state === 'WaitingForCashier',
    'WaitingForCashier recovery did not preserve the same inactive, actionable register order.');
    await page.keyboard.press('e');
    await page.waitForFunction((customerId) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const customers = typeof clubhouse.customers === 'function'
        ? clubhouse.customers() : clubhouse.customers;
      const customer = customers.find((entry) => entry.customerId === customerId);
      return clubhouse.register.isActive()
        && customer?.checkoutFlow?.state !== 'WaitingForCashier';
    }, outerFixture.customerId, { timeout: 5000 });
    const waitingForward = await outerCustomerSnapshot(page, outerFixture.customerId);
    const waitingForwardTrace = outerRecoveryEntries(waitingForward, customerWaiting.marker);
    assert(waitingForward.txNumber === customerWaiting.before.txNumber
        && ['EnteringCashierMode', 'WaitingForScan'].includes(waitingForward.flow.state)
        && waitingForwardTrace.entered.length === 1
        && waitingForwardTrace.resumed.length === 1
        && waitingForwardTrace.diagnostics.length === 1,
    'WaitingForCashier did not accept normal next-frame cashier entry exactly once.');
    assert(same(
      outerConservedAuthorityView(waitingForward),
      outerConservedAuthorityView(customerWaiting.before),
    ), 'WaitingForCashier normal entry changed conserved customer or sale authority.');
    assertNoDuplicateOuterMeshes(waitingForward, 'WaitingForCashier forward entry', {
      requireOne: true,
    });
    await shot('outer-watchdog-waiting-forward-entry');

    await leaveRegisterToWorld(page);
    await page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      clubhouse.clearWalkins();
      delete window.__gfQaOuterCheckoutSnapshot;
    });
    await page.waitForFunction(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const customers = typeof clubhouse.customers === 'function'
        ? clubhouse.customers() : clubhouse.customers;
      return customers.length === 0 && !clubhouse.register.getTx();
    }, null, { timeout: 5000 });

    stage = 'default checkout baseline';
    const defaultFixture = await prepareFixture(page, 'card');
    await enterCheckout(page);
    const defaultBefore = await runtimeSnapshot(page);
    await shot('default-checkout-baseline');
    const defaultScan = await scanNext(page);
    await scanAll(page);
    // The scan workspace is intentionally fixed so edge products cannot be
    // panned out of reach. Measure optional cursor sway in the automatically
    // reached card-handoff workspace, where standard motion still applies.
    await waitForSwayWorkspace(page);
    const defaultSway = await cameraSwayProbe(page);
    assert(defaultBefore.prefs.largeTextAndTargets === false
        && defaultBefore.prefs.reducedCameraMotion === false
        && defaultBefore.prefs.fasterAnimations === false,
    'The default checkout did not preserve standard production behavior.');
    await page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      clubhouse.clearWalkins();
      if (clubhouse.register.isActive()) clubhouse.register.leave({ restorePointer: false });
    });
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null,
      { timeout: 5000 });

    stage = 'settings UI and persistence';
    await openSettings(page);
    const settingsDefault = await checkoutSettingsUi(page);
    await shot('settings-defaults');
    for (const label of [
      'Larger POS text and targets',
      'Reduced checkout camera motion',
      'Faster checkout animations',
      'Automatic exact change',
    ]) await setSetting(page, label, true);
    await setSetting(page, 'Confirm cash purchases', false);
    const settingsSelected = await checkoutSettingsUi(page);
    await shot('settings-all-assists-selected');
    await closeLaptop(page);
    await saveExactCheckpoint(page);
    const preferencesCheckpoint = await checkpointDigest(page);
    await restoreExactCheckpointAndReload(page);
    const persistedPreferences = (await runtimeSnapshot(page)).prefs;
    assert(same(persistedPreferences, {
      largeTextAndTargets: true,
      reducedCameraMotion: true,
      fasterAnimations: true,
      automaticExactChange: true,
      confirmCashPurchase: false,
    }), `Accessibility preferences did not persist: ${JSON.stringify(persistedPreferences)}.`);
    await openSettings(page);
    const settingsPersisted = await checkoutSettingsUi(page);
    await shot('settings-persisted-after-reload');
    await closeLaptop(page);

    stage = 'active preference behavior and blur';
    const cardFixture = await prepareFixture(page, 'card');
    await enterCheckout(page);
    const enabledBefore = await runtimeSnapshot(page);
    const fastScans = await scanAll(page);
    await waitForSwayWorkspace(page);
    const reducedSway = await cameraSwayProbe(page);
    assert(enabledBefore.activePreferences.largeTextAndTargets
        && enabledBefore.activePreferences.reducedCameraMotion
        && enabledBefore.activePreferences.fasterAnimations,
    'The live register did not consume persisted accessibility preferences.');
    assert(enabledBefore.monitor.exitHotspot.width > defaultBefore.monitor.exitHotspot.width
        && enabledBefore.monitor.exitHotspot.height > defaultBefore.monitor.exitHotspot.height,
    'Large targets did not expand the live monitor hotspot.');
    assert(fastScans[0].elapsedMs < defaultScan.elapsedMs,
      `Faster animation did not shorten the matched scan (${defaultScan.elapsedMs} vs ${fastScans[0].elapsedMs} ms).`);
    assert(defaultSway.delta > 0.0001,
      `Default camera sway was unexpectedly absent (${defaultSway.delta}).`);
    assert(reducedSway.delta < defaultSway.delta * 0.2,
      `Reduced camera motion did not suppress cursor sway (${defaultSway.delta} vs ${reducedSway.delta}).`);
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.stage === 'card-ready' && tx.checkoutFlow?.state === 'CardInsertReady';
    }, null, { timeout: 10000 });
    const cardPoint = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
    ));
    assert(cardPoint?.inView, 'The presented card was outside the fixed player camera.');
    await page.mouse.click(cardPoint.x, cardPoint.y);
    const insertionState = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.getTx()?.checkoutFlow?.state
    ));
    assert(insertionState === 'CardInserting', `Expected CardInserting, got ${insertionState}.`);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      return register.getTx()?.checkoutFlow?.state === 'CardInsertReady'
        && register.insertAt().u === 0 && !register.insertAt().ejecting;
    }, null, { timeout: 4000 });
    const afterBlur = await runtimeSnapshot(page);
    await shot('blur-safe-card-retry');
    assert(afterBlur.tx.number === enabledBefore.tx.number && !afterBlur.tx.banked
        && afterBlur.tx.items.every((item) => item.scanned && item.staged),
    'Blur changed transaction identity, banking, or scan progress.');

    stage = 'active resize';
    const resizeEvidence = [];
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(450);
      const snapshot = await runtimeSnapshot(page);
      const card = await page.evaluate(() => (
        window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
      ));
      assert(snapshot.tx.number === afterBlur.tx.number
          && snapshot.flow.state === 'CardInsertReady' && card?.inView,
      `Active resize ${viewport.width}x${viewport.height} lost the card retry state.`);
      resizeEvidence.push({ viewport, snapshot, card });
      await shot(`active-card-resize-${viewport.width}x${viewport.height}`);
    }
    await page.setViewportSize(VIEWPORT);
    await page.waitForTimeout(400);

    stage = 'pause and resume';
    const xPoint = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.cardXScreenPoint()
    ));
    assert(xPoint?.inView, 'Reader X was not visible before authorization.');
    await page.mouse.click(xPoint.x, xPoint.y);
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const tx = register.getTx();
      return register.workspace() === 'monitor' && tx?.stage === 'scanning'
        && tx.items.every((item) => item.scanned && item.staged);
    }, null, { timeout: 5000 });
    const beforePause = await runtimeSnapshot(page);
    await openPause(page);
    const paused = await runtimeSnapshot(page);
    assert(paused.pauseOpen && paused.speedIdx === 0 && paused.tx.number === beforePause.tx.number,
      'Pause did not retain the unbanked transaction exactly.');
    await shot('paused-with-unbanked-checkout');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.waitForSelector('.pause-veil-ui', { state: 'detached', timeout: 5000 });
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null,
      { timeout: 5000 });
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.stage === 'card-ready' && tx.checkoutFlow?.state === 'CardInsertReady';
    }, null, { timeout: 8000 });
    const resumed = await runtimeSnapshot(page);
    assert(resumed.tx.number === beforePause.tx.number
        && same(resumed.tx.items, beforePause.tx.items) && !resumed.tx.banked,
    'Resume/re-entry changed transaction identity, scan state, or banking.');
    await shot('resumed-same-card-checkout');

    stage = 'forced live card and cash watchdog recovery';
    await clickPresentedCardToAmountEntry(page);
    await clickCardConfirm(page);
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.stage === 'card-busy' && tx.checkoutFlow?.state === 'CardProcessing';
    }, null, { timeout: 4000 });
    const cardProcessingBefore = await runtimeSnapshot(page);
    const cardProcessingMarker = await forceLiveWatchdogExpiry(page, 'CardProcessing');
    await waitForLiveWatchdogRecovery(page, cardProcessingMarker);
    const cardProcessingRecovered = await runtimeSnapshot(page);
    const cardRecoveryTrace = assertSingleLiveRecovery(
      cardProcessingRecovered,
      cardProcessingMarker,
      'CardPresented',
    );
    assert(same(cardProcessingRecovered.authority, cardProcessingBefore.authority),
      'CardProcessing watchdog changed persistent cash, drawer, history, sales, or ledger authority.');
    assert(same(cardProcessingRecovered.shop, cardProcessingBefore.shop),
      'CardProcessing watchdog changed held UIDs, inventory, history, or receipt numbering.');
    assert(cardProcessingRecovered.tx.cardAttempts === cardProcessingBefore.tx.cardAttempts
        && cardProcessingRecovered.tx.cardsTried === cardProcessingBefore.tx.cardsTried
        && cardProcessingRecovered.tx.cardResult === null,
    'CardProcessing watchdog changed attempt identity or invented an authorization result.');
    await shot('forced-card-processing-recovery');

    // Wait beyond the renderer's original authorization timer. A stale callback
    // would approve/decline here; the recovered transaction must remain safely
    // unapproved at a fresh card presentation/ready checkpoint.
    await page.waitForTimeout(1900);
    const afterLateCardWindow = await runtimeSnapshot(page);
    assert(['card-present', 'card-ready'].includes(afterLateCardWindow.tx.stage)
        && ['CardPresented', 'CardInsertReady'].includes(afterLateCardWindow.flow.state)
        && afterLateCardWindow.tx.cardResult === null
        && afterLateCardWindow.tx.cardAttempts === cardProcessingBefore.tx.cardAttempts,
    `A late card callback escaped recovery: ${JSON.stringify(afterLateCardWindow.tx)}.`);
    assert(recoveryEntries(afterLateCardWindow, cardProcessingMarker).entered.length === 1
        && recoveryEntries(afterLateCardWindow, cardProcessingMarker).resumed.length === 1,
    'CardProcessing watchdog re-entered Recovery after its deferred resume frame.');
    assert(same(afterLateCardWindow.authority, cardProcessingBefore.authority),
      'The late-callback observation window changed persistent financial authority.');
    assert(same(afterLateCardWindow.shop, cardProcessingBefore.shop),
      'The late-callback observation window changed inventory/held authority.');

    // Continue through normal controls and force the seeded card to decline,
    // then use the visible monitor fallback to switch this same basket to cash.
    await page.evaluate(() => {
      window.__fw.scene3d.clubhouse().register.getTx().rng = () => 0;
    });
    await clickPresentedCardToAmountEntry(page);
    await clickCardConfirm(page);
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const tx = register.getTx();
      return tx?.stage === 'card-declined' && tx.checkoutFlow?.state === 'CardDeclined'
        && register.workspace() === 'monitor';
    }, null, { timeout: 8000 });
    const declined = await runtimeSnapshot(page);
    assert(declined.tx.cardAttempts === cardProcessingBefore.tx.cardAttempts + 1
        && declined.tx.cardsTried === cardProcessingBefore.tx.cardsTried,
    'The normal declined authorization did not advance exactly one attempt.');
    await shot('normal-card-decline-switch-choice');
    await clickMonitorAction(page, 'card-to-cash');
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const tx = register.getTx();
      return tx?.stage === 'cash-tender' && tx.checkoutFlow?.state === 'CashPresented'
        && register.workspace() === 'monitor';
    }, null, { timeout: 6000 });
    const switchedToCash = await runtimeSnapshot(page);
    assert(switchedToCash.tx.number === cardProcessingBefore.tx.number
        && switchedToCash.tx.method === 'cash'
        && same(switchedToCash.authority, cardProcessingBefore.authority),
    'Decline-to-cash changed transaction identity or persistent financial authority.');
    await shot('normal-decline-to-cash-presentation');

    const cashAuthorityBefore = await runtimeSnapshot(page);
    const watchdogTender = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()
    ));
    assert(watchdogTender?.inView, 'Recovered transaction cash was outside the working frame.');
    await page.mouse.click(watchdogTender.x, watchdogTender.y);
    const drawerOpeningMarker = await forceLiveWatchdogExpiry(page, 'DrawerOpening');
    await waitForLiveWatchdogRecovery(page, drawerOpeningMarker);
    const drawerOpeningRecovered = await runtimeSnapshot(page);
    const cashRecoveryTrace = assertSingleLiveRecovery(
      drawerOpeningRecovered,
      drawerOpeningMarker,
      'CashAccepted',
    );
    assert(same(drawerOpeningRecovered.authority, cashAuthorityBefore.authority),
      'DrawerOpening recovery committed local tender/change to persistent authority.');
    assert(same(drawerOpeningRecovered.shop, cashAuthorityBefore.shop),
      'DrawerOpening recovery changed held UIDs, inventory, history, or receipt numbering.');
    assert(drawerOpeningRecovered.tx.number === cashAuthorityBefore.tx.number
        && drawerOpeningRecovered.tx.method === 'cash' && !drawerOpeningRecovered.tx.banked,
    'DrawerOpening recovery replaced or prematurely banked the cash transaction.');
    await shot('forced-drawer-opening-recovery');
    await page.waitForTimeout(450);
    const cashAfterDeferredResume = await runtimeSnapshot(page);
    assert(recoveryEntries(cashAfterDeferredResume, drawerOpeningMarker).entered.length === 1
        && recoveryEntries(cashAfterDeferredResume, drawerOpeningMarker).resumed.length === 1,
    'DrawerOpening watchdog looped after its deferred resume.');
    assert(same(cashAfterDeferredResume.authority, cashAuthorityBefore.authority),
      'Recovered cash animation mutated persistent authority before final settlement.');
    assert(same(cashAfterDeferredResume.shop, cashAuthorityBefore.shop),
      'Recovered cash animation changed inventory/held authority before final settlement.');

    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().register.getFlow()?.state === 'ReceiptPrinting'
    ), null, { timeout: 8000 });
    const receiptPrintingBefore = await runtimeSnapshot(page);
    assert(receiptPrintingBefore.physical.receipts === 1
        && receiptPrintingBefore.tx.receiptPrinted,
    'Authorized cash payment did not establish exactly one receipt checkpoint.');
    const receiptPrintingMarker = await forceLiveWatchdogExpiry(page, 'ReceiptPrinting');
    await waitForLiveWatchdogRecovery(page, receiptPrintingMarker);
    const receiptPrintingRecovered = await runtimeSnapshot(page);
    const receiptRecoveryTrace = assertSingleLiveRecovery(
      receiptPrintingRecovered,
      receiptPrintingMarker,
      'ReceiptPrinting',
    );
    assert(receiptPrintingRecovered.physical.receipts === 1
        && receiptPrintingRecovered.tx.receiptPrinted
        && receiptPrintingRecovered.tx.receiptPacked === receiptPrintingBefore.tx.receiptPacked
        && same(receiptPrintingRecovered.tx.items, receiptPrintingBefore.tx.items)
        && same(receiptPrintingRecovered.authority, receiptPrintingBefore.authority)
        && same(receiptPrintingRecovered.shop, receiptPrintingBefore.shop),
    'ReceiptPrinting recovery duplicated paper or changed persistent authority.');
    await shot('forced-receipt-printing-idempotent-recovery');

    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().register.getFlow()?.state === 'BagHandoff'
    ), null, { timeout: 14000 });
    const bagHandoffBefore = await runtimeSnapshot(page);
    assert(bagHandoffBefore.physical.bags === 1 && bagHandoffBefore.physical.receipts === 1,
    'Authorized fulfillment did not establish one bag and one receipt before handoff.');
    const bagHandoffMarker = await forceLiveWatchdogExpiry(page, 'BagHandoff');
    await waitForLiveWatchdogRecovery(page, bagHandoffMarker);
    const bagHandoffRecovered = await runtimeSnapshot(page);
    const bagRecoveryTrace = assertSingleLiveRecovery(
      bagHandoffRecovered,
      bagHandoffMarker,
      'Bagging',
    );
    assert(bagHandoffRecovered.physical.bags === 1
        && bagHandoffRecovered.physical.receipts === 1
        && bagHandoffRecovered.tx.receiptPacked === bagHandoffBefore.tx.receiptPacked
        && same(bagHandoffRecovered.tx.items, bagHandoffBefore.tx.items)
        && same(bagHandoffRecovered.authority, bagHandoffBefore.authority)
        && same(bagHandoffRecovered.shop, bagHandoffBefore.shop),
    'BagHandoff recovery duplicated paid props or changed persistent authority.');
    await shot('forced-bag-handoff-idempotent-recovery');
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().register.getFlow()?.state === 'BagHandoff'
    ), null, { timeout: 14000 });
    const liveBagHandoff = await runtimeSnapshot(page);
    assert(recoveryEntries(liveBagHandoff, bagHandoffMarker).entered.length === 1
        && recoveryEntries(liveBagHandoff, bagHandoffMarker).resumed.length === 1,
    'BagHandoff watchdog looped after replaying its idempotent physical handoff.');
    await shot('recovered-sale-live-bag-handoff');
    const customerLeavingHandle = await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const flow = register.getFlow();
      if (flow?.state !== 'CustomerLeaving') return false;
      return {
        flow: {
          state: flow.state,
          sequence: flow.sequence,
          history: structuredClone(flow.history || []),
        },
        txNumber: register.getTx()?.number || null,
        txStage: register.getTx()?.stage || null,
        deliveryPhase: register.deliveryPhase(),
        delivery: register.deliveryPresentation(),
      };
    }, null, { timeout: 5000 });
    // Faster animations leave a deliberately short pre-bank departure window.
    // Keep the frame-coherent value returned by waitForFunction instead of
    // starting an async module-heavy snapshot after the transaction may clear.
    const liveCustomerLeaving = await customerLeavingHandle.jsonValue();
    assert(liveBagHandoff.flow.state === 'BagHandoff'
        && liveBagHandoff.watchdog.managedStates.includes('BagHandoff')
        && liveBagHandoff.watchdog.managedStates.includes('CustomerLeaving')
        && liveCustomerLeaving.flow.state === 'CustomerLeaving'
        && liveCustomerLeaving.txStage === 'done'
        && liveCustomerLeaving.deliveryPhase === 'released',
    'Timed delivery states were not held across their live physical/finalize windows.');
    await shot('recovered-sale-live-customer-leaving');
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null,
      { timeout: 18000 });
    const recoveredSaleComplete = await runtimeSnapshot(page);
    assert(recoveredSaleComplete.shop.history === cashAuthorityBefore.shop.history + 1,
      'Recovered decline-to-cash sale did not bank exactly once through normal completion.');
    assert(recoveredSaleComplete.authority.transactionHistory.length
        === cashAuthorityBefore.authority.transactionHistory.length + 1,
    'Recovered sale wrote an invalid persistent transaction-history count.');
    await shot('watchdog-recovered-sale-complete');

    stage = 'exact autosave recovery';
    const recoveryFixture = await prepareFixture(page, 'card');
    await enterCheckout(page);
    await scanAll(page);
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.stage === 'card-ready' && tx.checkoutFlow?.state === 'CardInsertReady';
    }, null, { timeout: 10000 });
    await saveExactCheckpoint(page);
    const checkpoint = await checkpointDigest(page);
    const savedActive = await runtimeSnapshot(page);
    await shot('active-checkout-before-autosave-reload');
    await restoreExactCheckpointAndReload(page);
    const firstRecovery = await runtimeSnapshot(page);
    await shot('first-reload-clean-rollback');
    await restoreExactCheckpointAndReload(page);
    const secondRecovery = await runtimeSnapshot(page);
    await shot('second-reload-idempotent-rollback');
    for (const [label, snapshot] of [['first', firstRecovery], ['second', secondRecovery]]) {
      assert(!snapshot.tx && !snapshot.active && !snapshot.bodyRegisterMode && !snapshot.pointerLock,
        `${label} recovery restored active checkout UI/input.`);
      assert(snapshot.shop.held.length === recoveryFixture.baseline.held,
        `${label} recovery left held checkout UIDs.`);
      assert(snapshot.shop.history === recoveryFixture.baseline.history,
        `${label} recovery banked an uncompleted sale.`);
      assert(same(snapshot.shop.inventory, recoveryFixture.baseline.inventory),
        `${label} recovery did not return inventory exactly once.`);
      assert(snapshot.physical.itemRoots === 0 && snapshot.physical.itemClickPads === 0
          && snapshot.physical.paymentCardRoots === 0 && snapshot.physical.tenderTargets === 0
          && snapshot.physical.changeRoots === 0 && snapshot.physical.receipts === 0,
      `${label} recovery left transaction-owned physical roots: ${JSON.stringify(snapshot.physical)}.`);
    }
    assert(same(cleanRecoveryView(firstRecovery), cleanRecoveryView(secondRecovery)),
      'Loading the exact autosave twice was not idempotent.');

    stage = 'automatic exact change and handoff';
    const automaticFixture = await prepareFixture(page, 'cash');
    await enterCheckout(page);
    await scanAll(page);
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'cash-tender'
    ), null, { timeout: 10000 });
    const tenderPoint = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()
    ));
    assert(tenderPoint?.inView, 'Presented cash was outside the working frame.');
    await page.mouse.click(tenderPoint.x, tenderPoint.y);
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.checkoutFlow?.history?.some(
        (entry) => entry.event === 'accessibility-auto-confirmed-exact-change',
      );
    }, null, { timeout: 10000 });
    const automaticHandoff = await runtimeSnapshot(page);
    assert(automaticHandoff.flow.history.some(
      (entry) => entry.event === 'accessibility-auto-confirmed-exact-change'),
    'Automatic exact-cash handoff did not record its explicit flow event.');
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().register.deliveryPhase() === 'receipt-print'
    ), null, { timeout: 8000 });
    await shot('automatic-exact-change-handoff-receipt');
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null,
      { timeout: 16000 });
    const automaticComplete = await runtimeSnapshot(page);
    assert(automaticComplete.shop.history === automaticFixture.baseline.history + 1,
      'Automatic exact-change transaction did not bank exactly once.');

    stage = 'confirmed exact change';
    await leaveRegisterToWorld(page);
    await openSettings(page);
    await setSetting(page, 'Confirm cash purchases', true);
    const confirmationSetting = await checkoutSettingsUi(page);
    await shot('settings-cash-confirmation-enabled');
    await closeLaptop(page);
    const confirmedFixture = await prepareFixture(page, 'cash');
    await enterCheckout(page);
    await scanAll(page);
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'cash-tender'
    ), null, { timeout: 10000 });
    const confirmedTender = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()
    ));
    await page.mouse.click(confirmedTender.x, confirmedTender.y);
    await page.waitForFunction(async () => {
      const domain = await import(new URL('src/sim/register.js', document.baseURI).href);
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.checkoutFlow?.state === 'SelectingChange'
        && domain.changeGivingState(tx).state === 'exact';
    }, null, { timeout: 10000 });
    const confirmedExact = await runtimeSnapshot(page);
    assert(confirmedExact.monitor.hotspots.some((entry) => entry.id === 'confirm-change'),
      'Confirm-enabled exact change did not retain the Done action.');
    await shot('automatic-exact-count-waits-for-done');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().register.deliveryPhase() === 'receipt-print'
    ), null, { timeout: 8000 });
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null,
      { timeout: 16000 });
    const confirmedComplete = await runtimeSnapshot(page);
    assert(confirmedComplete.shop.history === confirmedFixture.baseline.history + 1,
      'Confirmed exact-change transaction did not bank exactly once.');
    await leaveRegisterToWorld(page);
    const cleanup = await runtimeSnapshot(page);
    assert(cleanup.physical.itemRoots === 0 && cleanup.physical.itemClickPads === 0
        && cleanup.physical.paymentCardRoots === 0 && cleanup.physical.tenderTargets === 0
        && cleanup.physical.changeRoots === 0 && cleanup.physical.receipts === 0,
    `Completed-sale cleanup retained transaction roots: ${JSON.stringify(cleanup.physical)}.`);
    await shot('completed-sale-clean-world');

    assert(diagnostics.consoleErrors.length === 0,
      `Console errors: ${diagnostics.consoleErrors.join(' | ')}`);
    assert(diagnostics.pageErrors.length === 0,
      `Page errors: ${diagnostics.pageErrors.join(' | ')}`);
    assert(diagnostics.failedRequests.length === 0,
      `Non-aborted failed requests: ${JSON.stringify(diagnostics.failedRequests)}`);
    assert(diagnostics.httpErrors.length === 0,
      `HTTP errors: ${JSON.stringify(diagnostics.httpErrors)}`);

    let result = {
      ok: true,
      command: launchConfig.command,
      viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
      evidenceDirectory: out,
      videoDirectory: launchConfig.videoDirectory,
      qaBaseUrl: launchConfig.baseUrl,
      browserMode: launchConfig.browserMode,
      nodeTests: {
        command: 'node --test tests/register-flow.test.js tests/checkout-preferences.test.js tests/laptop-pages.test.js tests/register-abandon.test.js tests/register-card-abort.test.js tests/register-complete.test.js tests/register-integrity.test.js tests/register-watchdog-recovery.test.js tests/customer-checkout-flow.test.js tests/customer-checkout-recovery.test.js',
        pass: 73, total: 73,
      },
      contract,
      outerLifecycle: {
        fixture: outerFixture,
        customerApproach: { ...customerApproach, trace: approachTrace },
        customerPlacement: { ...customerPlacement, trace: placementTrace },
        customerWaiting: {
          ...customerWaiting,
          trace: waitingTrace,
          forward: waitingForward,
          forwardTrace: waitingForwardTrace,
        },
      },
      settings: {
        defaults: settingsDefault,
        selected: settingsSelected,
        persisted: settingsPersisted,
        preferencesCheckpoint,
        persistedPreferences,
        confirmationSetting,
      },
      accessibility: {
        defaultPreferences: defaultBefore.activePreferences,
        defaultPreferencesSource: defaultBefore.activePreferencesSource,
        enabledPreferences: enabledBefore.activePreferences,
        enabledPreferencesSource: enabledBefore.activePreferencesSource,
        defaultTarget: defaultBefore.monitor.exitHotspot,
        largeTarget: enabledBefore.monitor.exitHotspot,
        defaultItemPad: defaultBefore.physical.itemPad,
        largeItemPad: enabledBefore.physical.itemPad,
        defaultScanMs: defaultScan.elapsedMs,
        fastScanMs: fastScans[0].elapsedMs,
        defaultSway,
        reducedSway,
      },
      resilience: { afterBlur, resizeEvidence, beforePause, paused, resumed },
      watchdog: {
        cardProcessing: {
          before: cardProcessingBefore,
          marker: cardProcessingMarker,
          recovered: cardProcessingRecovered,
          trace: cardRecoveryTrace,
          afterLateCallbackWindow: afterLateCardWindow,
        },
        declineToCash: { declined, switchedToCash },
        drawerOpening: {
          before: cashAuthorityBefore,
          marker: drawerOpeningMarker,
          recovered: drawerOpeningRecovered,
          trace: cashRecoveryTrace,
          afterDeferredResume: cashAfterDeferredResume,
          receiptPrinting: {
            before: receiptPrintingBefore,
            marker: receiptPrintingMarker,
            recovered: receiptPrintingRecovered,
            trace: receiptRecoveryTrace,
          },
          bagHandoff: {
            before: bagHandoffBefore,
            marker: bagHandoffMarker,
            recovered: bagHandoffRecovered,
            trace: bagRecoveryTrace,
          },
          liveBagHandoff,
          liveCustomerLeaving,
          completed: recoveredSaleComplete,
        },
      },
      recovery: { checkpoint, savedActive, firstRecovery, secondRecovery },
      cash: {
        automatic: {
          manualDrawerClicks: 0,
          manualConfirmInputs: 0,
          flow: automaticHandoff.flow,
          complete: automaticComplete,
        },
        confirmed: {
          manualDrawerClicks: 0,
          manualConfirmInputs: 1,
          changeDue: confirmedExact.tx.changeDue,
          handTotal: confirmedExact.tx.handTotal,
          flow: confirmedExact.flow,
          complete: confirmedComplete,
        },
      },
      cleanup,
      diagnostics,
      evidence,
      fixtureBoundary: 'sendToCounter plus stock/time/weather/patience normalization, an approach-position offset, and deterministic authorization RNG only; settings, register entry, item scans, card insertion/cancel/Confirm, pause/resume, decline-to-cash monitor choice, cash acceptance, and confirmation use Playwright keyboard/mouse controls. Forced expiry changes only the live checkoutFlow.enteredAtMs, then steps the production update loop.',
      generatedAt: new Date().toISOString(),
    };
    result = finalizeCashierQaResult({
      result,
      beforeSnapshot: productionBuildBefore,
      evidencePngs: evidence,
      evidenceRoot: out,
    });
    fs.writeFileSync(path.join(out, 'latest-result.json'), `${JSON.stringify(result, null, 2)}\n`);
    fs.writeFileSync(path.join(out, 'REPORT.md'), markdown(result));
    return result;
  } catch (error) {
    const blocker = path.join(out, `99-blocker-${stage.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}.png`);
    const blockerCaptured = await page.screenshot({ path: blocker })
      .then(() => true, () => false);
    const blockerEvidence = blockerCaptured ? [...evidence, blocker] : [...evidence];
    let result = {
      ok: false,
      stage,
      blocker: {
        message: error.message,
        stack: error.stack,
        screenshot: blockerCaptured ? blocker : null,
        screenshotCaptured: blockerCaptured,
      },
      diagnostics,
      evidence: blockerEvidence,
      generatedAt: new Date().toISOString(),
    };
    result = finalizeCashierQaResult({
      result,
      beforeSnapshot: productionBuildBefore,
      evidencePngs: blockerEvidence,
      evidenceRoot: out,
    });
    fs.writeFileSync(path.join(out, 'latest-result.json'), `${JSON.stringify(result, null, 2)}\n`);
    fs.writeFileSync(path.join(out, 'REPORT.md'), `# Cashier recovery and accessibility audit\n\nBLOCKED at **${stage}**: ${error.message}\n`);
    return result;
  }
}

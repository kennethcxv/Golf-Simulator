// CUSTOMER VIEW — the physical expression of the serializable customer sim.
//
// The domain module owns identity, lifecycle, stock reservations, queues,
// satisfaction and reload policy. This module owns pooled Three.js actors,
// authored sockets, collision-aware movement, animation and the narrow adapters
// into the existing register/front-desk interfaces.

import * as THREE from 'three';
import { makeCharacter } from '../characterAsset.js';
import { makeNav } from './nav.js';
import { skuById } from '../../data/shopItems.js';
import { COUNTER, REGISTER } from '../../data/shopLayout.js';
import { placedFixtures } from '../../sim/layout.js';
import { addRevenue } from '../../sim/economy.js';
import { calendarOf } from '../../sim/time.js';
import { checkInReservation, fmtSlot, reservationById, TEE_SHEET } from '../../sim/reservations.js';
import { postReview, reviewFor } from '../../sim/reviews.js';
import {
  CUSTOMER_INTENT,
  CUSTOMER_OUTCOME,
  CUSTOMER_STATE,
  RECOVERY_ACTION,
  activateArrival,
  claimSocket,
  createFixtureCustomer,
  customerById,
  customerSimulationOf,
  customerSimulationSummary,
  despawnCustomer,
  ensureCustomerSimulation,
  evaluateCustomerSatisfaction,
  joinServiceQueue,
  leaveServiceQueue,
  markCheckInCompleted,
  markCheckoutCompleted,
  markCheckoutFailed,
  markCheckoutStarted,
  noteCustomerBlocked,
  noteCustomerProgress,
  recoverCustomerSimulation,
  releaseCustomerProducts,
  releaseDueArrivals,
  releaseSocket,
  requestCustomerRecovery,
  reserveCustomerProduct,
  resumeCustomerAfterRecovery,
  reviewVisitForCustomer,
  serviceQueuePosition,
  tickCustomerQueueWait,
  transitionCustomer,
} from '../../sim/customerSimulation.js';
import {
  CUSTOMER_AMBIENT_SOCKETS,
  CUSTOMER_EXTERIOR_SOCKETS,
  CUSTOMER_SAFE_ANCHORS,
  browseSocketsForFixture,
  serviceQueueSockets,
} from '../../data/customerSockets.js';

const PROFILES = [
  { polo: 0x3f674b, khaki: 0xc2b190, skin: 0xd9a97e, cap: 0xf2efe4 },
  { polo: 0x334e71, khaki: 0x8a8577, skin: 0xb9865e, cap: 0x2c3e66 },
  { polo: 0x8b5e68, khaki: 0x4b545c, skin: 0x8a5f42, cap: null },
  { polo: 0xa26345, khaki: 0x6b5a44, skin: 0xe8c39a, cap: 0xf2efe4 },
  { polo: 0x58735d, khaki: 0xc2b190, skin: 0xb9865e, cap: null },
  { polo: 0x5a6370, khaki: 0x8a8577, skin: 0xd9a97e, cap: 0x3f674b },
];

const PRODUCT_COLORS = {
  balls: 0xf3f0e4,
  accessories: 0xc4a15e,
  apparel: 0x7892a9,
  clubs: 0x8b765f,
};

const RETAIL_INTENTS = new Set([
  CUSTOMER_INTENT.PRO_SHOP_SHOPPER,
  CUSTOMER_INTENT.BROWSER,
  CUSTOMER_INTENT.SPECIFIC_ITEM,
]);

const FRONT_DESK_INTENTS = new Set([
  CUSTOMER_INTENT.RESERVATION_CHECK_IN,
  CUSTOMER_INTENT.WALK_IN_TEE_TIME,
]);

const shared = {
  productBox: new THREE.BoxGeometry(0.24, 0.18, 0.18),
  clubShaft: new THREE.CylinderGeometry(0.012, 0.012, 0.72, 7),
  clubHead: new THREE.BoxGeometry(0.16, 0.08, 0.1),
  bagBody: new THREE.BoxGeometry(0.22, 0.28, 0.13),
  bagHandle: new THREE.TorusGeometry(0.07, 0.012, 5, 10, Math.PI),
  patienceRing: new THREE.RingGeometry(0.105, 0.126, 24),
  productMaterials: new Map(),
  patienceMaterials: new Map(),
};

function cachedMaterial(map, key, make) {
  if (!map.has(key)) map.set(key, make());
  return map.get(key);
}

function idNumber(value) {
  return Number(String(value || '').replace(/\D/g, '')) || 1;
}

function hash01(value, salt = 0) {
  const n = Math.sin((idNumber(value) + salt * 101.3) * 12.9898) * 43758.5453;
  return n - Math.floor(n);
}

function angleToward(root, target, dt) {
  if (target?.faceX == null || target?.faceZ == null) return;
  const want = Math.atan2(target.faceX - root.position.x, target.faceZ - root.position.z);
  let delta = want - root.rotation.y;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  root.rotation.y += delta * Math.min(1, dt * 6);
}

function modelForSku(sku) {
  if (!sku) return null;
  if (sku.id.startsWith('driver')) return 'head_driver';
  if (sku.id.startsWith('irons')) return 'head_iron';
  if (sku.id.startsWith('wedge')) return 'head_wedge';
  if (sku.id.startsWith('putter')) return 'head_putter';
  if (sku.id.startsWith('polo')) return 'polo_folded';
  if (sku.id === 'glove1') return 'glove';
  if (sku.id === 'cap1') return 'cap';
  if (sku.id === 'jacket2') return 'jacket_hanging';
  if (sku.id === 'shoe1') return 'shoe';
  if (sku.id === 'bag1') return 'bag';
  if (sku.id === 'range2') return 'rangefinder';
  return null;
}

export function createCustomerView(B, options) {
  const { state, custGroup, hooks, walk, L2W, merch } = B;
  const {
    camera,
    center,
    custCols,
    getColVersion,
    groundYAt,
    heightAt,
    isInside,
    mainDoor,
    rebuildStock,
    register,
  } = options;

  ensureCustomerSimulation(state);

  const actors = [];
  const byId = new Map();
  const pool = [];
  const queueSockets = serviceQueueSockets();
  const nav = makeNav({
    minX: center.x - 25,
    maxX: center.x + 25,
    minZ: center.z - 22,
    maxZ: center.z + 28,
    cell: 0.3,
    radius: 0.32,
  });
  let navVersion = -1;
  let runtimeSeconds = 0;
  let arrivalPoll = 0;
  let disposed = false;

  const worldPoint = (point) => {
    const world = L2W(point.x, point.z);
    const result = { ...point, x: world.x, z: world.z };
    if (Number.isFinite(point.faceX) && Number.isFinite(point.faceZ)) {
      const face = L2W(point.faceX, point.faceZ);
      result.faceX = face.x;
      result.faceZ = face.z;
    }
    return result;
  };

  const floorAt = (x, z) => groundYAt(x, z) ?? heightAt(x, z);

  function navFresh() {
    const version = getColVersion();
    if (version !== navVersion) {
      nav.rebuild(custCols.filter((collider) => !collider.door));
      navVersion = version;
    }
    return nav;
  }

  function makePatienceIndicator() {
    const material = cachedMaterial(shared.patienceMaterials, 'amber', () => new THREE.MeshBasicMaterial({
      color: 0xf2c14e,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      depthWrite: false,
    }));
    const mesh = new THREE.Mesh(shared.patienceRing, material);
    mesh.position.y = 1.74;
    mesh.renderOrder = 3;
    mesh.visible = false;
    return mesh;
  }

  function makePoolActor(slot) {
    const character = makeCharacter(PROFILES[slot % PROFILES.length]);
    character.root.scale.setScalar(0.87 + (slot % 4) * 0.025);
    character.root.userData.char = character;
    const patienceMesh = makePatienceIndicator();
    character.root.add(patienceMesh);
    const actor = {
      slot,
      mesh: character.root,
      character,
      patienceMesh,
      entity: null,
      path: [],
      pathGoal: null,
      pathVersion: -1,
      stateSeen: null,
      stateTimer: 0,
      updateDebt: 0,
      itemMesh: null,
      itemVisualKey: null,
      bagMesh: null,
      tx: null,
      paid: false,
      reviewed: false,
      entered: false,
      recoveryTarget: null,
      flags: {},
    };
    Object.defineProperties(actor, {
      id: { get: () => actor.entity?.id },
      name: { get: () => actor.entity?.name || 'A customer' },
      cart: { get: () => actor.entity?.cart || [] },
      payMethod: { get: () => actor.entity?.payMethod || 'card' },
      discount: { get: () => actor.entity?.discount || 0 },
    });
    actor.onPaid = (tx) => onCheckoutPaid(actor, tx);
    return actor;
  }

  function clearAttachments(actor) {
    if (actor.itemMesh) actor.mesh.remove(actor.itemMesh);
    if (actor.bagMesh) actor.mesh.remove(actor.bagMesh);
    actor.itemMesh = null;
    actor.itemVisualKey = null;
    actor.bagMesh = null;
  }

  function initialPoint(entity) {
    if (entity.position && Number.isFinite(entity.position.x) && Number.isFinite(entity.position.z)) return entity.position;
    if (entity.queueAssignment) {
      const socket = queueSockets[Math.min(queueSockets.length - 1, entity.queueAssignment.position || 0)];
      return worldPoint(socket);
    }
    if ([CUSTOMER_STATE.LEAVING, CUSTOMER_STATE.EXITING].includes(entity.state)) return worldPoint(CUSTOMER_SAFE_ANCHORS.exit);
    if ([CUSTOMER_STATE.CHOOSING_ACTIVITY, CUSTOMER_STATE.MOVING_TO_DISPLAY, CUSTOMER_STATE.BROWSING].includes(entity.state)) {
      return worldPoint(CUSTOMER_SAFE_ANCHORS.salesFloor);
    }
    const socketId = claimSocket(
      state,
      entity,
      'exterior-spawn',
      CUSTOMER_EXTERIOR_SOCKETS.spawns.map((socket) => socket.id),
    );
    const socket = CUSTOMER_EXTERIOR_SOCKETS.spawns.find((entry) => entry.id === socketId)
      || CUSTOMER_EXTERIOR_SOCKETS.spawns[idNumber(entity.id) % CUSTOMER_EXTERIOR_SOCKETS.spawns.length];
    return worldPoint(socket);
  }

  function acquireActor(entity) {
    let actor = pool.pop();
    if (!actor) actor = makePoolActor(actors.length + pool.length);
    actor.entity = entity;
    actor.mesh.visible = true;
    actor.mesh.userData.customerId = entity.id;
    actor.mesh.userData.customerState = entity.state;
    actor.mesh.userData.customerIntent = entity.intent;
    actor.path = [];
    actor.pathGoal = null;
    actor.pathVersion = -1;
    actor.stateSeen = entity.state;
    actor.stateTimer = 0;
    actor.updateDebt = 0;
    actor.tx = null;
    actor.paid = false;
    actor.reviewed = false;
    actor.entered = !!entity.entered;
    actor.recoveryTarget = null;
    actor.flags = {};
    clearAttachments(actor);
    const point = initialPoint(entity);
    actor.mesh.position.set(point.x, floorAt(point.x, point.z), point.z);
    entity.position = { x: point.x, z: point.z };
    custGroup.add(actor.mesh);
    actors.push(actor);
    byId.set(entity.id, actor);
    updateHeldVisual(actor);
    return actor;
  }

  function releaseActor(actor) {
    clearAttachments(actor);
    actor.patienceMesh.visible = false;
    custGroup.remove(actor.mesh);
    byId.delete(actor.entity?.id);
    const index = actors.indexOf(actor);
    if (index >= 0) actors.splice(index, 1);
    actor.entity = null;
    actor.tx = null;
    actor.mesh.userData.customerId = null;
    actor.mesh.userData.customerState = null;
    actor.mesh.visible = false;
    pool.push(actor);
  }

  function syncActors() {
    const sim = customerSimulationOf(state);
    const activeIds = new Set(sim.active.map((entity) => entity.id));
    for (const actor of [...actors]) if (!activeIds.has(actor.entity.id)) releaseActor(actor);
    for (const entity of sim.active) if (!byId.has(entity.id)) acquireActor(entity);
  }

  function setState(actor, next, reason, force = false) {
    const entity = actor.entity;
    if (!entity || entity.state === next) return false;
    const result = transitionCustomer(state, entity, next, reason, state.clock.minutes, { force });
    if (!result.ok) return false;
    actor.stateSeen = next;
    actor.stateTimer = 0;
    actor.path = [];
    actor.pathGoal = null;
    actor.recoveryTarget = null;
    actor.flags = {};
    actor.mesh.userData.customerState = next;
    return true;
  }

  function claimedPoint(entity, group, points) {
    const id = claimSocket(state, entity, group, points.map((point) => point.id));
    const point = points.find((entry) => entry.id === id);
    return point ? worldPoint(point) : null;
  }

  function queueTarget(entity) {
    const position = serviceQueuePosition(state, entity);
    if (position < 0) return null;
    return worldPoint(queueSockets[Math.min(queueSockets.length - 1, position)]);
  }

  function browseTarget(entity) {
    const assignment = entity.browseAssignment;
    if (!assignment) return null;
    const fixture = placedFixtures(state).find((entry) => entry.id === assignment.fixtureId);
    if (!fixture) return null;
    const point = browseSocketsForFixture(fixture).find((entry) => entry.id === assignment.socketId);
    return point ? worldPoint(point) : null;
  }

  function chooseBrowseAssignment(entity) {
    releaseSocket(state, entity, 'browse');
    entity.browseAssignment = null;
    let fixtures = placedFixtures(state).filter((fixture) => fixture.skus?.length);
    if (entity.desiredSkuId) fixtures = fixtures.filter((fixture) => fixture.skus.includes(entity.desiredSkuId));
    fixtures.sort((a, b) => {
      const as = a.skus.some((id) => (state.shop.inventory[id]?.shelf || 0) > 0) ? 0 : 1;
      const bs = b.skus.some((id) => (state.shop.inventory[id]?.shelf || 0) > 0) ? 0 : 1;
      return as - bs || a.id.localeCompare(b.id);
    });
    if (!fixtures.length) return null;
    const offset = Math.floor(hash01(entity.id, entity.activityCount + 7) * fixtures.length);
    for (let i = 0; i < fixtures.length; i += 1) {
      const fixture = fixtures[(i + offset) % fixtures.length];
      const sockets = browseSocketsForFixture(fixture);
      const socketId = claimSocket(state, entity, 'browse', sockets.map((socket) => socket.id));
      if (!socketId) continue;
      entity.browseAssignment = { fixtureId: fixture.id, socketId, skuIds: [...fixture.skus] };
      return browseTarget(entity);
    }
    return null;
  }

  function setFaceAnimation(actor, mode, target, dt) {
    actor.character.setMode(mode);
    angleToward(actor.mesh, target, dt);
  }

  function resolveMotion(actor, nx, nz) {
    const radius = 0.3;
    for (const collider of custCols) {
      if (collider.door) continue;
      if (nx + radius <= collider.minX || nx - radius >= collider.maxX || nz + radius <= collider.minZ || nz - radius >= collider.maxZ) continue;
      const left = nx + radius - collider.minX;
      const right = collider.maxX - (nx - radius);
      const up = nz + radius - collider.minZ;
      const down = collider.maxZ - (nz - radius);
      const min = Math.min(left, right, up, down);
      if (min === left) nx = collider.minX - radius;
      else if (min === right) nx = collider.maxX + radius;
      else if (min === up) nz = collider.minZ - radius;
      else nz = collider.maxZ + radius;
    }
    if (walk.active) {
      const distance = Math.hypot(nx - walk.x, nz - walk.z);
      if (distance > 0.001 && distance < 0.74) {
        nx = walk.x + ((nx - walk.x) / distance) * 0.74;
        nz = walk.z + ((nz - walk.z) / distance) * 0.74;
      }
    }
    for (const other of actors) {
      if (other === actor || !other.mesh.visible) continue;
      const dx = nx - other.mesh.position.x;
      const dz = nz - other.mesh.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 0.001 && distance < 0.62) {
        nx = other.mesh.position.x + (dx / distance) * 0.62;
        nz = other.mesh.position.z + (dz / distance) * 0.62;
      }
    }
    return { x: nx, z: nz };
  }

  function moveTo(actor, target, dt, mode = 'Walk') {
    if (!target) {
      noteCustomerBlocked(actor.entity, dt);
      return false;
    }
    const entity = actor.entity;
    const root = actor.mesh;
    if (walk.active
      && Math.hypot(root.position.x - walk.x, root.position.z - walk.z) < 0.74
      && Math.hypot(root.position.x - target.x, root.position.z - target.z) < 0.45) {
      noteCustomerBlocked(entity, dt);
      actor.character.setMode('Idle');
      return false;
    }
    const version = getColVersion();
    const changed = !actor.pathGoal
      || Math.hypot(actor.pathGoal.x - target.x, actor.pathGoal.z - target.z) > 0.18
      || actor.pathVersion !== version;
    if (changed) {
      actor.path = navFresh().path(root.position.x, root.position.z, target.x, target.z) || [];
      actor.pathGoal = { x: target.x, z: target.z };
      actor.pathVersion = version;
      entity.currentPath = actor.path.map((point) => ({ x: point.x, z: point.z }));
      entity.target = { id: target.id || null, x: target.x, z: target.z };
    }
    while (actor.path.length > 1 && Math.hypot(actor.path[0].x - root.position.x, actor.path[0].z - root.position.z) < 0.28) {
      actor.path.shift();
    }
    const waypoint = actor.path[0];
    if (!waypoint) {
      noteCustomerBlocked(entity, dt);
      actor.character.setMode('Idle');
      return false;
    }
    const dx = waypoint.x - root.position.x;
    const dz = waypoint.z - root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.001) return true;
    const step = Math.min(distance, entity.speed * dt);
    const resolved = resolveMotion(actor, root.position.x + (dx / distance) * step, root.position.z + (dz / distance) * step);
    const moved = Math.hypot(resolved.x - root.position.x, resolved.z - root.position.z);
    root.position.x = resolved.x;
    root.position.z = resolved.z;
    root.position.y = floorAt(resolved.x, resolved.z);
    const want = Math.atan2(dx, dz);
    let turn = want - root.rotation.y;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    root.rotation.y += turn * Math.min(1, dt * 7.5);
    actor.character.setMode(mode);
    if (moved > Math.max(0.002, step * 0.35)) noteCustomerProgress(entity, state.clock.minutes, resolved);
    else noteCustomerBlocked(entity, dt);
    entity.position = { x: root.position.x, z: root.position.z };
    return Math.hypot(target.x - root.position.x, target.z - root.position.z) < 0.19;
  }

  function productVisual(skuId) {
    const sku = skuById(skuId);
    const group = new THREE.Group();
    const modelName = modelForSku(sku);
    let model = modelName && (modelName === 'rangefinder'
      ? merch.instantiateRaw(modelName, { scale: 0.4 })
      : merch.instantiate(modelName, { tint: PRODUCT_COLORS[sku?.cat], scale: 0.4 }));
    if (sku?.cat === 'clubs') {
      const material = cachedMaterial(shared.productMaterials, 'clubs', () => new THREE.MeshStandardMaterial({
        color: PRODUCT_COLORS.clubs, roughness: 0.55, metalness: 0.25,
      }));
      const shaft = new THREE.Mesh(shared.clubShaft, material);
      shaft.rotation.z = 0.22;
      const head = model || new THREE.Mesh(shared.clubHead, material);
      head.position.set(0.08, -0.34, 0);
      group.add(shaft, head);
    } else if (model) {
      model.rotation.y = Math.PI / 2;
      group.add(model);
    } else {
      const color = PRODUCT_COLORS[sku?.cat] || 0x999999;
      const material = cachedMaterial(shared.productMaterials, color, () => new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
      group.add(new THREE.Mesh(shared.productBox, material));
    }
    group.position.set(0.17, 0.72, 0.15);
    group.rotation.set(-0.1, 0.2, -0.08);
    return group;
  }

  function bagVisual() {
    const model = merch.instantiate('bag_open', { scale: 0.42 });
    if (model) {
      model.position.set(0.3, 0.56, 0.04);
      model.rotation.y = 0.2;
      return model;
    }
    const group = new THREE.Group();
    const green = cachedMaterial(shared.productMaterials, 'shop-bag', () => new THREE.MeshStandardMaterial({ color: 0x28563a, roughness: 0.86 }));
    const brass = cachedMaterial(shared.productMaterials, 'shop-bag-handle', () => new THREE.MeshStandardMaterial({ color: 0xb79c62, roughness: 0.7 }));
    const body = new THREE.Mesh(shared.bagBody, green);
    body.position.y = 0.14;
    const handle = new THREE.Mesh(shared.bagHandle, brass);
    handle.position.y = 0.29;
    handle.rotation.x = Math.PI / 2;
    group.add(body, handle);
    group.position.set(0.3, 0.56, 0.04);
    return group;
  }

  function basketVisual() {
    const model = merch.instantiate('basket', { scale: 0.52 });
    if (model) {
      model.position.set(0.16, 0.6, 0.16);
      model.rotation.y = 0.2;
      return model;
    }
    return productVisual('balls1');
  }

  function updateHeldVisual(actor) {
    const shouldCarry = actor.entity?.cart?.length
      && ![CUSTOMER_STATE.STAGING_PRODUCTS, CUSTOMER_STATE.WAITING_FOR_CASHIER, CUSTOMER_STATE.PAYING].includes(actor.entity.state);
    const visualKey = shouldCarry
      ? (actor.entity.cart.length > 1 ? 'basket' : actor.entity.cart[0].skuId)
      : null;
    if (actor.itemMesh && actor.itemVisualKey !== visualKey) {
      actor.mesh.remove(actor.itemMesh);
      actor.itemMesh = null;
      actor.itemVisualKey = null;
    }
    if (shouldCarry && !actor.itemMesh) {
      actor.itemMesh = visualKey === 'basket' ? basketVisual() : productVisual(visualKey);
      actor.itemVisualKey = visualKey;
      actor.mesh.add(actor.itemMesh);
    } else if (!shouldCarry && actor.itemMesh) {
      actor.mesh.remove(actor.itemMesh);
      actor.itemMesh = null;
      actor.itemVisualKey = null;
    }
  }

  function showBag(actor) {
    if (actor.bagMesh) return;
    actor.bagMesh = bagVisual();
    actor.mesh.add(actor.bagMesh);
  }

  function updatePatience(actor) {
    const entity = actor.entity;
    const waited = entity.experience?.waitTimeSec || 0;
    const fraction = Math.max(0, Math.min(1, 1 - waited / Math.max(1, entity.patienceSec)));
    const show = entity.queueAssignment && fraction < 0.62;
    actor.patienceMesh.visible = !!show;
    if (!show) return;
    const key = fraction < 0.22 ? 'red' : fraction < 0.42 ? 'orange' : 'amber';
    const color = key === 'red' ? 0xe45f56 : key === 'orange' ? 0xef9838 : 0xf2c14e;
    actor.patienceMesh.material = cachedMaterial(shared.patienceMaterials, key, () => new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false,
    }));
    actor.patienceMesh.scale.setScalar(0.72 + fraction * 0.28);
    if (camera) actor.patienceMesh.rotation.y = Math.atan2(
      camera.position.x - actor.mesh.position.x,
      camera.position.z - actor.mesh.position.z,
    ) - actor.mesh.rotation.y;
  }

  function routeFromChoice(actor) {
    const entity = actor.entity;
    if (FRONT_DESK_INTENTS.has(entity.intent)) {
      setState(actor, CUSTOMER_STATE.MOVING_TO_QUEUE, 'front-desk visitor joined the shared service line');
      return;
    }
    if (entity.intent === CUSTOMER_INTENT.LOUNGE_VISITOR) {
      if (entity.activityCount >= entity.maxActivities) setState(actor, CUSTOMER_STATE.LEAVING, 'lounge visit complete');
      else setState(actor, CUSTOMER_STATE.LOUNGE_USE, 'chose a clubhouse lounge activity');
      return;
    }
    if (entity.cart.length) {
      setState(actor, CUSTOMER_STATE.MOVING_TO_QUEUE, 'finished shopping with reserved goods');
      return;
    }
    const target = chooseBrowseAssignment(entity);
    if (target) setState(actor, CUSTOMER_STATE.MOVING_TO_DISPLAY, 'selected an available display socket');
    else {
      entity.reasons.push('the sales floor was too congested to browse');
      setState(actor, CUSTOMER_STATE.LEAVING, 'no safe display socket available');
    }
  }

  function selectProduct(actor) {
    const entity = actor.entity;
    const assignment = entity.browseAssignment;
    const candidates = (assignment?.skuIds || []).filter((skuId) => {
      if (entity.desiredSkuId && skuId !== entity.desiredSkuId) return false;
      return (state.shop.inventory[skuId]?.shelf || 0) > 0;
    });
    entity.activityCount += 1;
    const buyChance = entity.intent === CUSTOMER_INTENT.SPECIFIC_ITEM ? 1
      : entity.intent === CUSTOMER_INTENT.PRO_SHOP_SHOPPER ? 0.7 : 0.18;
    const wantsIt = hash01(entity.id, entity.activityCount + 19) < buyChance;
    if (!candidates.length) {
      const wanted = entity.desiredSkuId || assignment?.skuIds?.[0];
      if (wanted) reserveCustomerProduct(state, entity, wanted);
    } else if (wantsIt) {
      const skuId = candidates[Math.floor(hash01(entity.id, entity.activityCount + 31) * candidates.length)];
      const result = reserveCustomerProduct(state, entity, skuId);
      if (result.ok) {
        rebuildStock();
        releaseSocket(state, entity, 'browse');
        entity.browseAssignment = null;
        updateHeldVisual(actor);
        setState(actor, CUSTOMER_STATE.CARRYING_PRODUCT, `reserved real shelf unit ${result.item.uid}`);
        return;
      }
    } else {
      entity.experience.productAvailability = 1;
    }
    releaseSocket(state, entity, 'browse');
    entity.browseAssignment = null;
    if (entity.activityCount < entity.maxActivities) setState(actor, CUSTOMER_STATE.CHOOSING_ACTIVITY, 'continued browsing');
    else setState(actor, CUSTOMER_STATE.LEAVING, 'finished browsing without a purchase');
  }

  function abandonCustomer(actor, reason) {
    const entity = actor.entity;
    if (!entity || entity.state === CUSTOMER_STATE.DESPAWNED) return;
    const hadProducts = entity.cart.length > 0;
    if (register.getCustomer() === actor) {
      register.abandon();
      register.leave();
    }
    if ([CUSTOMER_STATE.WAITING_FOR_CASHIER, CUSTOMER_STATE.PAYING].includes(entity.state)) {
      markCheckoutFailed(state, entity, reason);
    } else {
      entity.experience.checkoutSuccess = hadProducts ? 0 : entity.experience.checkoutSuccess;
      entity.reasons.push(reason);
    }
    entity.experience.abandonedReason = reason;
    if (hadProducts) {
      releaseCustomerProducts(state, entity);
      state.shop.lostSalesTotal = (state.shop.lostSalesTotal || 0) + 1;
      rebuildStock();
    }
    leaveServiceQueue(state, entity);
    releaseSocket(state, entity);
    updateHeldVisual(actor);
    setState(actor, CUSTOMER_STATE.LEAVING, reason, true);
    if (hooks.toast && walk.active && isInside(walk.x, walk.z)) hooks.toast(`${entity.name} left: ${reason}.`, 'warn');
  }

  function onCheckoutPaid(actor, tx) {
    if (!actor.entity || !customerById(state, actor.entity.id)) return;
    actor.paid = true;
    markCheckoutCompleted(state, actor.entity);
    leaveServiceQueue(state, actor.entity);
    releaseSocket(state, actor.entity);
    actor.tx = tx;
    updateHeldVisual(actor);
    showBag(actor);
    rebuildStock();
    actor.stateSeen = actor.entity.state;
    actor.stateTimer = 0;
    actor.mesh.userData.customerState = actor.entity.state;
  }

  function postDepartureReview(entity) {
    const evaluation = evaluateCustomerSatisfaction(state, entity);
    const always = evaluation?.outcome === CUSTOMER_OUTCOME.DISSATISFIED;
    if (!entity.entered || (!always && hash01(entity.id, 83) >= 0.42)) return;
    const seed = idNumber(entity.id) * 997 + Math.floor(state.clock.minutes / 1440);
    postReview(state, reviewFor(state, reviewVisitForCustomer(entity), seed));
  }

  function finishDeparture(actor, reason = 'left the property') {
    const entity = actor.entity;
    postDepartureReview(entity);
    despawnCustomer(state, entity, { reason });
    releaseActor(actor);
  }

  function performRecovery(actor) {
    const entity = actor.entity;
    const action = requestCustomerRecovery(state, entity, state.clock.minutes);
    actor.path = [];
    actor.pathGoal = null;
    navVersion = -1;
    if (action === RECOVERY_ACTION.ALTERNATE_APPROACH) {
      releaseSocket(state, entity, 'door-approach');
      releaseSocket(state, entity, 'browse');
      entity.doorAssignment = null;
      entity.browseAssignment = null;
    } else if (action === RECOVERY_ACTION.RELEASE_OPTIONAL) {
      releaseSocket(state, entity, 'browse');
      releaseSocket(state, entity, 'ambient');
      entity.browseAssignment = null;
      entity.occupancyAssignment = null;
      entity.recoveryResumeState = entity.cart.length ? CUSTOMER_STATE.MOVING_TO_QUEUE : CUSTOMER_STATE.CHOOSING_ACTIVITY;
    } else if (action === RECOVERY_ACTION.SAFE_ANCHOR) {
      const local = isInside(actor.mesh.position.x, actor.mesh.position.z)
        ? CUSTOMER_SAFE_ANCHORS.salesFloor
        : CUSTOMER_SAFE_ANCHORS.entry;
      actor.recoveryTarget = worldPoint(local);
      return;
    } else if (action === RECOVERY_ACTION.EMERGENCY_REPOSITION) {
      const distance = camera ? camera.position.distanceTo(actor.mesh.position) : 99;
      const toActor = camera ? actor.mesh.position.clone().sub(camera.position).normalize() : null;
      const forward = camera ? new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion) : null;
      const hidden = !camera || distance > 20 || forward.dot(toActor) < -0.15;
      if (hidden) {
        const safe = worldPoint(isInside(actor.mesh.position.x, actor.mesh.position.z)
          ? CUSTOMER_SAFE_ANCHORS.salesFloor
          : CUSTOMER_SAFE_ANCHORS.entry);
        actor.mesh.position.set(safe.x, floorAt(safe.x, safe.z), safe.z);
        entity.position = { x: safe.x, z: safe.z };
      } else {
        entity.experience.abandonedReason = 'navigation remained blocked';
        entity.recoveryResumeState = CUSTOMER_STATE.LEAVING;
      }
    }
    resumeCustomerAfterRecovery(state, entity, state.clock.minutes);
    actor.stateSeen = entity.state;
    actor.stateTimer = 0;
    actor.mesh.userData.customerState = entity.state;
  }

  function updateRecovery(actor, dt) {
    if (actor.recoveryTarget) {
      if (moveTo(actor, actor.recoveryTarget, dt, 'Walk')) {
        resumeCustomerAfterRecovery(state, actor.entity, state.clock.minutes);
        actor.recoveryTarget = null;
        actor.stateSeen = actor.entity.state;
        actor.stateTimer = 0;
      }
      return;
    }
    performRecovery(actor);
  }

  function servicePatienceExpired(actor) {
    const entity = actor.entity;
    const waited = entity.experience.waitTimeSec || 0;
    if (entity.state === CUSTOMER_STATE.PAYING) return waited > entity.patienceSec + 210;
    return waited > entity.patienceSec;
  }

  function updateActorState(actor, dt) {
    const entity = actor.entity;
    const stateName = entity.state;
    const root = actor.mesh;
    actor.stateTimer += dt;

    if (entity.blockedDuration >= 4 && stateName !== CUSTOMER_STATE.RECOVERY) {
      performRecovery(actor);
      return;
    }

    if (stateName === CUSTOMER_STATE.APPROACHING_PROPERTY) {
      const target = claimedPoint(entity, 'exterior-arrival', CUSTOMER_EXTERIOR_SOCKETS.arrivals);
      if (moveTo(actor, target, dt) ) {
        releaseSocket(state, entity, 'exterior-spawn');
        releaseSocket(state, entity, 'exterior-arrival');
        setState(actor, CUSTOMER_STATE.EXTERIOR_ARRIVAL, 'reached the clubhouse approach');
      }
    } else if (stateName === CUSTOMER_STATE.EXTERIOR_ARRIVAL) {
      actor.character.setMode('Idle');
      if (actor.stateTimer > 0.7) setState(actor, CUSTOMER_STATE.WALKING_TO_ENTRANCE, 'continued to the entrance');
    } else if (stateName === CUSTOMER_STATE.WALKING_TO_ENTRANCE) {
      const target = claimedPoint(entity, 'door-approach', CUSTOMER_EXTERIOR_SOCKETS.approach);
      if (moveTo(actor, target, dt, 'Door')) setState(actor, CUSTOMER_STATE.WAITING_FOR_DOOR, 'queued at an entrance approach slot');
    } else if (stateName === CUSTOMER_STATE.WAITING_FOR_DOOR) {
      const target = claimedPoint(entity, 'door-approach', CUSTOMER_EXTERIOR_SOCKETS.approach);
      setFaceAnimation(actor, 'Idle', worldPoint(CUSTOMER_EXTERIOR_SOCKETS.entry), dt);
      if (target) {
        mainDoor.openFor(root.position.x, root.position.z, runtimeSeconds);
        const passage = claimSocket(state, entity, 'door-passage', ['main-door']);
        if (passage && Math.abs(mainDoor.angle) > 0.3) setState(actor, CUSTOMER_STATE.ENTERING, 'entrance passage became available');
      }
    } else if (stateName === CUSTOMER_STATE.ENTERING) {
      mainDoor.openFor(root.position.x, root.position.z, runtimeSeconds);
      if (moveTo(actor, worldPoint(CUSTOMER_EXTERIOR_SOCKETS.entry), dt, 'Door')) {
        releaseSocket(state, entity, 'door-passage');
        releaseSocket(state, entity, 'door-approach');
        entity.entered = true;
        actor.entered = true;
        if (hooks.sfx) hooks.sfx('doorbell');
        setState(actor, CUSTOMER_STATE.CHOOSING_ACTIVITY, 'entered the clubhouse');
      }
    } else if (stateName === CUSTOMER_STATE.CHOOSING_ACTIVITY) {
      actor.character.setMode('Turn');
      if (actor.stateTimer > 0.22) routeFromChoice(actor);
    } else if (stateName === CUSTOMER_STATE.MOVING_TO_DISPLAY) {
      const target = browseTarget(entity) || chooseBrowseAssignment(entity);
      if (!target) setState(actor, CUSTOMER_STATE.CHOOSING_ACTIVITY, 'display socket changed');
      else if (moveTo(actor, target, dt)) setState(actor, CUSTOMER_STATE.BROWSING, 'arrived beside the display');
    } else if (stateName === CUSTOMER_STATE.BROWSING) {
      const target = browseTarget(entity);
      setFaceAnimation(actor, 'Browse', target, dt);
      if (actor.stateTimer > 1.8 + hash01(entity.id, entity.activityCount) * 1.6) {
        setState(actor, CUSTOMER_STATE.INSPECTING_PRODUCT, 'noticed a product');
      }
    } else if (stateName === CUSTOMER_STATE.INSPECTING_PRODUCT) {
      setFaceAnimation(actor, 'Inspect', browseTarget(entity), dt);
      if (actor.stateTimer > 1.25) setState(actor, CUSTOMER_STATE.SELECTING_PRODUCT, 'finished inspecting the product');
    } else if (stateName === CUSTOMER_STATE.SELECTING_PRODUCT) {
      setFaceAnimation(actor, 'Reach', browseTarget(entity), dt);
      if (actor.stateTimer > 0.7) selectProduct(actor);
    } else if (stateName === CUSTOMER_STATE.CARRYING_PRODUCT) {
      actor.character.setMode('Carry');
      if (actor.stateTimer > 0.55) {
        const browseAgain = entity.cart.length < 2
          && entity.activityCount < entity.maxActivities
          && hash01(entity.id, entity.activityCount + 53) < 0.35;
        setState(actor, browseAgain ? CUSTOMER_STATE.CHOOSING_ACTIVITY : CUSTOMER_STATE.MOVING_TO_QUEUE,
          browseAgain ? 'continued shopping while carrying a product' : 'headed for the service queue');
      }
    } else if (stateName === CUSTOMER_STATE.MOVING_TO_QUEUE) {
      if (serviceQueuePosition(state, entity) < 0) {
        const joined = joinServiceQueue(state, entity, state.clock.minutes);
        if (!joined.ok) {
          actor.character.setMode('Idle');
          if (actor.stateTimer > 8) abandonCustomer(actor, 'the service line was full');
          return;
        }
      }
      const target = queueTarget(entity);
      if (moveTo(actor, target, dt, entity.cart.length ? 'Carry' : 'Walk')) {
        setState(actor, CUSTOMER_STATE.WAITING_IN_QUEUE, 'settled into the assigned FIFO queue slot');
      }
    } else if (stateName === CUSTOMER_STATE.WAITING_IN_QUEUE) {
      const target = queueTarget(entity);
      const arrived = moveTo(actor, target, dt, entity.cart.length ? 'Carry' : 'Walk');
      if (arrived) setFaceAnimation(actor, entity.cart.length ? 'Carry' : 'Idle', target, dt);
      if (servicePatienceExpired(actor)) {
        abandonCustomer(actor, 'the service wait exceeded their patience');
      } else if (serviceQueuePosition(state, entity) === 0 && !register.hasTx()) {
        setState(actor, CUSTOMER_STATE.MOVING_TO_REGISTER, 'reached the head of the service queue');
      }
    } else if (stateName === CUSTOMER_STATE.MOVING_TO_REGISTER) {
      const target = worldPoint(queueSockets[0]);
      if (moveTo(actor, target, dt, entity.cart.length ? 'Carry' : 'Walk')) {
        setState(actor,
          FRONT_DESK_INTENTS.has(entity.intent) ? CUSTOMER_STATE.FRONT_DESK_INQUIRY : CUSTOMER_STATE.STAGING_PRODUCTS,
          FRONT_DESK_INTENTS.has(entity.intent) ? 'waiting for front-desk help' : 'placed products at the register');
      }
    } else if (stateName === CUSTOMER_STATE.STAGING_PRODUCTS) {
      setFaceAnimation(actor, 'Stage', worldPoint({
        x: REGISTER.staging.minX,
        z: REGISTER.staging.minZ,
        faceX: REGISTER.scanner.x,
        faceZ: COUNTER.z,
      }), dt);
      if (actor.stateTimer > 0.85 && !actor.flags.registerAttempted) {
        actor.flags.registerAttempted = true;
        updateHeldVisual(actor);
        if (register.begin(actor)) {
          actor.tx = register.getTx();
          setState(actor, CUSTOMER_STATE.WAITING_FOR_CASHIER, 'physical products staged for the cashier');
        } else {
          setState(actor, CUSTOMER_STATE.WAITING_IN_QUEUE, 'register became unavailable', true);
        }
      }
    } else if (stateName === CUSTOMER_STATE.WAITING_FOR_CASHIER) {
      const tx = register.getCustomer() === actor ? register.getTx() : null;
      setFaceAnimation(actor, 'Stage', worldPoint({ x: REGISTER.scanner.x, z: COUNTER.z }), dt);
      if (!tx && !actor.paid && actor.stateTimer > 0.5) {
        markCheckoutFailed(state, entity, 'checkout was interrupted before payment');
        actor.tx = null;
        setState(actor, CUSTOMER_STATE.WAITING_IN_QUEUE, 'returned to a safe retry point', true);
      } else if (tx && !['scanning', 'payment'].includes(tx.stage)) {
        markCheckoutStarted(state, entity, tx.id || null);
        actor.stateSeen = entity.state;
        actor.stateTimer = 0;
      } else if (servicePatienceExpired(actor)) {
        abandonCustomer(actor, 'checkout service took too long');
      }
    } else if (stateName === CUSTOMER_STATE.PAYING) {
      actor.character.setMode(entity.payMethod === 'cash' ? 'PayCash' : 'PayCard');
      const ownsRegister = register.getCustomer() === actor;
      if (!ownsRegister && !actor.paid && actor.stateTimer > 0.6) {
        markCheckoutFailed(state, entity, 'payment did not complete');
        actor.tx = null;
        setState(actor, CUSTOMER_STATE.WAITING_IN_QUEUE, 'returned to a safe retry point', true);
      } else if (servicePatienceExpired(actor)) {
        abandonCustomer(actor, 'payment could not be completed');
      }
    } else if (stateName === CUSTOMER_STATE.RECEIVING_BAG_AND_RECEIPT) {
      actor.character.setMode('Receive');
      showBag(actor);
      if (actor.stateTimer > 1.3) setState(actor, CUSTOMER_STATE.LEAVING, 'received the bag and receipt');
    } else if (stateName === CUSTOMER_STATE.FRONT_DESK_INQUIRY) {
      setFaceAnimation(actor, 'Idle', worldPoint(queueSockets[0]), dt);
      if (servicePatienceExpired(actor)) abandonCustomer(actor, 'front-desk service took too long');
    } else if (stateName === CUSTOMER_STATE.CHECK_IN) {
      actor.character.setMode('Receive');
      if (actor.stateTimer > 1.2) {
        leaveServiceQueue(state, entity);
        setState(actor, CUSTOMER_STATE.LEAVING, 'front-desk service completed');
      }
    } else if (stateName === CUSTOMER_STATE.LOUNGE_USE) {
      let target = null;
      if (entity.occupancyAssignment) {
        const point = CUSTOMER_AMBIENT_SOCKETS.find((entry) => entry.id === entity.occupancyAssignment.socketId);
        if (point) target = worldPoint(point);
      }
      if (!target) {
        const umbrella = CUSTOMER_AMBIENT_SOCKETS.find((entry) => entry.kind === 'umbrella');
        const raining = (state.weather?.today?.rainIn || 0) > 0.05;
        const candidates = raining
          ? [umbrella, ...CUSTOMER_AMBIENT_SOCKETS.filter((entry) => entry !== umbrella)]
          : CUSTOMER_AMBIENT_SOCKETS.filter((entry) => entry.kind !== 'umbrella');
        let point = null;
        if (raining && umbrella) point = claimedPoint(entity, 'ambient', [umbrella]);
        if (!point) point = claimedPoint(entity, 'ambient', candidates);
        if (point) {
          entity.occupancyAssignment = { socketId: point.id };
          target = point;
        }
      }
      if (!target) {
        if (actor.stateTimer > 4) setState(actor, CUSTOMER_STATE.CHOOSING_ACTIVITY, 'lounge was occupied');
      } else if (!actor.flags.loungeArrived) {
        if (moveTo(actor, target, dt)) {
          actor.flags.loungeArrived = true;
          actor.flags.loungeTimer = 0;
        }
      } else {
        actor.flags.loungeTimer += dt;
        const mode = target.kind === 'sit' ? 'Sit' : target.kind === 'talk' ? 'Talk' : 'Browse';
        setFaceAnimation(actor, mode, target, dt);
        if (actor.flags.loungeTimer > 5 + hash01(entity.id, 71) * 5) {
          entity.activityCount += 1;
          releaseSocket(state, entity, 'ambient');
          entity.occupancyAssignment = null;
          setState(actor, CUSTOMER_STATE.CHOOSING_ACTIVITY, 'finished the lounge activity');
        }
      }
    } else if (stateName === CUSTOMER_STATE.LEAVING) {
      if (register.getCustomer() === actor) abandonCustomer(actor, 'left before checkout completed');
      leaveServiceQueue(state, entity);
      releaseSocket(state, entity, 'browse');
      releaseSocket(state, entity, 'ambient');
      const outside = !isInside(root.position.x, root.position.z);
      if (outside) {
        setState(actor, CUSTOMER_STATE.EXITING, 'already outside the clubhouse');
      } else {
        const target = worldPoint(CUSTOMER_EXTERIOR_SOCKETS.exitWait);
        if (moveTo(actor, target, dt, 'Leave')) {
          const passage = claimSocket(state, entity, 'door-passage', ['main-door']);
          mainDoor.openFor(root.position.x, root.position.z, runtimeSeconds);
          if (passage && Math.abs(mainDoor.angle) > 0.3) setState(actor, CUSTOMER_STATE.EXITING, 'exit passage became available');
        }
      }
    } else if (stateName === CUSTOMER_STATE.EXITING) {
      mainDoor.openFor(root.position.x, root.position.z, runtimeSeconds);
      const phase = actor.flags.exitPhase || 0;
      const target = worldPoint(phase === 0 ? CUSTOMER_EXTERIOR_SOCKETS.exit : CUSTOMER_EXTERIOR_SOCKETS.gone);
      if (moveTo(actor, target, dt, 'Leave')) {
        if (phase === 0) {
          actor.flags.exitPhase = 1;
          releaseSocket(state, entity, 'door-passage');
          actor.path = [];
          actor.pathGoal = null;
        } else finishDeparture(actor);
      }
    } else if (stateName === CUSTOMER_STATE.RECOVERY) {
      updateRecovery(actor, dt);
    }
  }

  function updateActor(actor, dt) {
    if (!actor.entity) return;
    if (actor.stateSeen !== actor.entity.state) {
      actor.stateSeen = actor.entity.state;
      actor.stateTimer = 0;
      actor.path = [];
      actor.pathGoal = null;
      actor.flags = {};
    }
    actor.mesh.userData.customerState = actor.entity.state;
    actor.mesh.userData.customerIntent = actor.entity.intent;
    if (actor.entity.queueAssignment) tickCustomerQueueWait(actor.entity, dt);
    updatePatience(actor);
    updateHeldVisual(actor);

    const cameraDistance = camera ? camera.position.distanceTo(actor.mesh.position) : 0;
    actor.mesh.visible = cameraDistance < 92;
    actor.updateDebt += dt;
    const cadence = cameraDistance > 45 ? 0.2 : 0;
    if (actor.updateDebt < cadence) return;
    const step = Math.min(0.25, actor.updateDebt);
    actor.updateDebt = 0;
    actor.character.update(step);
    updateActorState(actor, step);
    if (actor.entity) {
      actor.mesh.position.y = floorAt(actor.mesh.position.x, actor.mesh.position.z);
      actor.entity.position = { x: actor.mesh.position.x, z: actor.mesh.position.z };
    }
  }

  function releaseArrivals() {
    const sim = customerSimulationOf(state);
    const due = releaseDueArrivals(state, state.clock.minutes, {
      activeCount: sim.active.length,
      queueLength: sim.serviceQueue.length,
    });
    for (const arrival of due) activateArrival(state, arrival, state.clock.minutes);
  }

  function closeOutAfterHours() {
    const minute = calendarOf(state.clock.minutes).minuteOfDay;
    if (minute >= 360 && minute <= 1200) return;
    for (const actor of actors) {
      const entity = actor.entity;
      if ([CUSTOMER_STATE.PAYING, CUSTOMER_STATE.RECEIVING_BAG_AND_RECEIPT, CUSTOMER_STATE.LEAVING, CUSTOMER_STATE.EXITING].includes(entity.state)) continue;
      abandonCustomer(actor, 'the clubhouse closed');
    }
  }

  function update(dt) {
    if (disposed) return;
    runtimeSeconds += dt;
    arrivalPoll += dt;
    if (arrivalPoll >= 0.5) {
      arrivalPoll = 0;
      releaseArrivals();
      closeOutAfterHours();
    }
    syncActors();
    for (const actor of [...actors]) updateActor(actor, dt);
  }

  function headFrontDeskActor() {
    const sim = customerSimulationOf(state);
    const actor = byId.get(sim.serviceQueue[0]);
    if (!actor || actor.entity.state !== CUSTOMER_STATE.FRONT_DESK_INQUIRY) return null;
    return FRONT_DESK_INTENTS.has(actor.entity.intent) ? actor : null;
  }

  function frontDeskLabel() {
    if (register.hasTx()) return null;
    const actor = headFrontDeskActor();
    if (!actor) return null;
    const entity = actor.entity;
    if (entity.intent === CUSTOMER_INTENT.RESERVATION_CHECK_IN) {
      const reservation = reservationById(state, entity.reservationId);
      if (!reservation) return `Front desk — [E] help ${entity.name} find their booking`;
      const late = calendarOf(state.clock.minutes).minuteOfDay - reservation.minute;
      const suffix = late > 0 ? ` · ${Math.round(late)} min late` : '';
      return `Front desk — [E] check in ${entity.name} (${fmtSlot(reservation.minute)}, $${Math.round(reservation.fee)})${suffix}`;
    }
    return `Front desk — [E] help ${entity.name} with a walk-in tee time`;
  }

  function handleFrontDesk() {
    if (register.hasTx()) return false;
    const actor = headFrontDeskActor();
    if (!actor) return false;
    const entity = actor.entity;
    if (entity.intent === CUSTOMER_INTENT.RESERVATION_CHECK_IN) {
      const reservation = reservationById(state, entity.reservationId);
      const minute = calendarOf(state.clock.minutes).minuteOfDay;
      const late = reservation ? minute - reservation.minute : 999;
      if (!reservation || reservation.status !== 'booked') {
        markCheckInCompleted(state, entity, false, 'no open booking was found');
        if (hooks.toast) hooks.toast(`No open booking found for ${entity.name}.`, 'warn');
        setState(actor, CUSTOMER_STATE.LEAVING, 'front desk could not find the booking', true);
        leaveServiceQueue(state, entity);
        return true;
      }
      if (late > 45) {
        markCheckInCompleted(state, entity, false, 'arrived more than 45 minutes after the tee time');
        if (hooks.toast) hooks.toast(`${entity.name} missed the late-arrival window; no fee was charged.`, 'warn');
        setState(actor, CUSTOMER_STATE.LEAVING, 'late-arrival policy declined check-in', true);
        leaveServiceQueue(state, entity);
        return true;
      }
      const result = checkInReservation(state, reservation.id);
      markCheckInCompleted(state, entity, result.ok, result.reason || 'reservation confirmed');
      if (hooks.toast) {
        hooks.toast(result.ok
          ? `${entity.name} checked in — $${Math.round(result.fee)} green fee collected${late > 0 ? ' with a late-arrival warning' : ''}.`
          : result.reason, result.ok ? undefined : 'warn');
      }
      if (result.ok && hooks.sfx) hooks.sfx('chime');
      actor.stateSeen = entity.state;
      actor.stateTimer = 0;
      return true;
    }

    const minute = calendarOf(state.clock.minutes).minuteOfDay;
    const open = minute >= TEE_SHEET.openMin && minute < TEE_SHEET.closeMin;
    if (!open) {
      markCheckInCompleted(state, entity, false, 'walk-in play was unavailable outside tee-sheet hours');
      if (hooks.toast) hooks.toast('No walk-in tee times are available now; no fee was charged.', 'warn');
      setState(actor, CUSTOMER_STATE.LEAVING, 'walk-in request declined', true);
      leaveServiceQueue(state, entity);
      return true;
    }
    const fee = state.club.greenFee || 0;
    addRevenue(state, 'greenFees', fee);
    markCheckInCompleted(state, entity, true, 'walk-in tee time confirmed');
    if (hooks.toast) hooks.toast(`${entity.name} has a walk-in tee time — $${Math.round(fee)} green fee collected.`);
    if (hooks.sfx) hooks.sfx('chime');
    actor.stateSeen = entity.state;
    actor.stateTimer = 0;
    return true;
  }

  function debugSpawn(toCounter = false, intent = CUSTOMER_INTENT.PRO_SHOP_SHOPPER, fixtureOptions = {}) {
    const entity = createFixtureCustomer(state, intent, fixtureOptions);
    if (!entity) return null;
    syncActors();
    if (toCounter) {
      if (FRONT_DESK_INTENTS.has(entity.intent)) sendExistingToService(entity);
      else {
        const skuId = fixtureOptions.skuId
          || Object.keys(state.shop.inventory).find((id) => (state.shop.inventory[id]?.shelf || 0) > 0);
        if (skuId) sendExistingToCounter(entity, [skuId], fixtureOptions.payMethod || null);
      }
    }
    return byId.get(entity.id) || null;
  }

  function sendExistingToService(entity) {
    const joined = joinServiceQueue(state, entity, state.clock.minutes);
    if (!joined.ok) return null;
    transitionCustomer(state, entity, CUSTOMER_STATE.WAITING_IN_QUEUE, 'QA fixture: accounted shopper at service line', state.clock.minutes, { force: true });
    entity.entered = true;
    syncActors();
    const actor = byId.get(entity.id);
    const target = queueTarget(entity) || worldPoint(queueSockets[0]);
    actor.mesh.position.set(target.x, floorAt(target.x, target.z), target.z);
    entity.position = { x: target.x, z: target.z };
    actor.stateSeen = entity.state;
    actor.stateTimer = 0;
    actor.path = [];
    actor.pathGoal = null;
    updateHeldVisual(actor);
    return actor;
  }

  function sendExistingToCounter(entity, skuIds, payMethod = null) {
    if (payMethod) entity.payMethod = payMethod;
    for (const skuId of skuIds) reserveCustomerProduct(state, entity, skuId);
    if (!entity.cart.length) return null;
    const actor = sendExistingToService(entity);
    if (!actor) {
      releaseCustomerProducts(state, entity);
      rebuildStock();
      return null;
    }
    rebuildStock();
    return actor;
  }

  function sendToCounter(skuIds, payMethod = null) {
    const entity = createFixtureCustomer(state, CUSTOMER_INTENT.PRO_SHOP_SHOPPER);
    if (!entity) return null;
    const actor = sendExistingToCounter(entity, skuIds, payMethod);
    if (!actor) {
      despawnCustomer(state, entity, { reason: 'QA fixture had no available products' });
      syncActors();
      return null;
    }
    return actor.name;
  }

  function diagnostics() {
    return {
      ...customerSimulationSummary(state),
      actors: actors.map((actor) => ({
        id: actor.id,
        name: actor.name,
        state: actor.entity.state,
        intent: actor.entity.intent,
        queuePosition: serviceQueuePosition(state, actor.entity),
        cart: actor.entity.cart.map((item) => ({ uid: item.uid, skuId: item.skuId })),
        blockedDuration: actor.entity.blockedDuration,
        recoveryAttempts: actor.entity.recoveryAttempts,
        position: { x: actor.mesh.position.x, z: actor.mesh.position.z },
      })),
      runtimeSeconds,
      pool: { active: actors.length, available: pool.length, created: actors.length + pool.length },
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (register.getCustomer()) register.abandon();
    register.leave();
    recoverCustomerSimulation(state);
    for (const actor of [...actors]) releaseActor(actor);
  }

  syncActors();

  return {
    actors,
    update,
    frontDeskLabel,
    handleFrontDesk,
    debugSpawn,
    sendToCounter,
    diagnostics,
    dispose,
  };
}

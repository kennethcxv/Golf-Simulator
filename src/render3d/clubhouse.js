// THE CLUBHOUSE — one real building in the course world. The exterior shell
// and the pro-shop interior are the SAME geometry (walls with true openings),
// so they align by construction: you walk up the porch, open the hinged door
// with [E], and step inside with no transition, fade, or scene swap.
//
// Everything in here reads/writes game state ONLY through sim functions —
// this stays a live window onto state.shop, never a second simulation.
// Coordinates: the floor plan (src/data/shopLayout.js) is building-local;
// interaction props and colliders register into the course scene's shared
// walkProps/propColliders in WORLD coordinates.

import * as THREE from 'three';
import { clamp, rngOf } from '../core/utils.js';
import { fitDistance } from '../core/screenFit.js';
import { LAPTOP, screenCornersLocal, screenNormalLocal } from '../core/laptopRig.js';
import { makeCharacter } from './characterAsset.js';
import { SHOP_CATALOG, SHELF_CAP, DECOR_SPOTS } from '../data/shopItems.js';
import {
  SHELL, INTERIOR, FIXTURES, FIXTURE_HALF, COUNTER, OFFICE, STOCKROOM, LOUNGE,
  DOOR_MAIN, DOOR_STOCK, DOOR_BACK,
  MAT, HOURS_SIGN, queueSlot, REGISTER, COUNTER_TOP, fixtureBrowsePoint,
} from '../data/shopLayout.js';
import {
  RENO, shopCondition, cleanGrimeAt, clearClutter, placeDecor, removeDecor,
  restockShelfFromBackroom, priceFor, windowDirtAvg,
} from '../sim/shop.js';
import {
  boxesOf, pickUpBox, putDownBox, carriedBox, openBox, emptyTrash,
  cutTape, openFlap, takeFromBox, flattenBox, recycleCarriedBox,
  tapeCut, tapeUncut, flapsOpen, isEmpty, boxState,
  deliveryEquipmentPlacementForCarriedBox,
  handTruckPlacementForCarriedBox, stockingCartPlacementForCarriedBox, PAD_CAPACITY,
} from '../sim/deliveries.js';
import {
  carriedGoods, stockFixture, storeInBack, carrySpeedFactor,
} from '../sim/stocking.js';
import { boxDims, boxKindFor } from '../data/boxes.js';
import {
  FLOOR_BOX_SURFACE_ID,
  deliveryEquipmentSurfaceId,
} from '../data/boxPlacementSurfaces.js';
import {
  HAND_TRUCK_EQUIPMENT_ID,
  STOCKING_CART_EQUIPMENT_ID,
} from '../data/deliveryEquipment.js';
import {
  deliveryVanCargoOrientations, planDeliveryVanCargo,
} from '../data/deliveryVanCargo.js';
import {
  DELIVERY_PALLET_STAGING, deliveryPalletCentres, planPalletizedPadBoxes,
} from '../data/deliveryStaging.js';
import { pickFromShelf, returnToShelf } from '../sim/checkout.js';
import { drawPaymentMethod, paymentDistributionReport } from '../sim/paymentBag.js';
import { totalOf } from '../sim/register.js';
import { addRevenue } from '../sim/economy.js';
import { tutorialFlag } from '../sim/tutorial.js';
import {
  dueForCheckIn, dueForArrivals, markReservationEnRoute, markReservationArrived,
  walkInAvailability, selectWalkInSlot, fmtSlot, deskReservationList,
} from '../sim/reservations.js';
import {
  allocateCustomerIdentity, customerIdentityById, paymentChoiceDialogue,
  recordCustomerVisit,
} from '../sim/customerIdentity.js';
import { makeClubhouseMaterials, roundedBox, makeSignTexture, makeProductLabel } from './clubhouse/materials.js';
import { createMerch } from './clubhouse/merch.js';
import {
  createDeliveryEquipment, DELIVERY_EQUIPMENT_DEFAULT_LAYOUT, DELIVERY_VAN_BEATS,
  DELIVERY_VAN_ROUTE,
} from './clubhouse/deliveryEquipment.js';
import { createOwnedStockResources } from './clubhouse/stockResources.js';
import { createRegisterItemResources } from './clubhouse/registerItemResources.js';
import { suppressInteriorSunShadows } from './clubhouse/interiorShadowPolicy.js';
import {
  collectMaterialResources, collectRenderableResources, disposeRenderableResources,
  mergeRenderableResources,
} from './clubhouse/resourceLifecycle.js';
import {
  buildCatalogProductProxy, catalogCheckoutLayout, catalogProductVisual,
} from './clubhouse/catalogProductVisual.js';
import {
  canBuildDeliveryBoxVisual, createDeliveryBoxVisual,
} from './clubhouse/deliveryBoxVisual.js';
import { deliveryBoxCarryProfile } from './clubhouse/deliveryCarryProfile.js';
import { slotsFor, homeFixture } from '../data/fixtureSlots.js';
import { buildShell } from './clubhouse/shell.js';
import { buildDoors } from './clubhouse/doors.js';
import { createSheet06ProductionRuntime } from './assets51to100/sheet06ProductionRuntime.js';
import { createSheet06NavigationContract } from './assets51to100/sheet06Navigation.js';
import { buildFixtures, buildLounge, buildStockroomDressing, buildCheckout } from './clubhouse/fixtures.js';
import { createRegisterMode } from './clubhouse/simplifiedRegisterMode.js';
import { buildDirt } from './clubhouse/dirt.js';
import { makeNav } from './clubhouse/nav.js';
import { productThumb } from './clubhouse/thumbs.js';
import { buildExterior } from './clubhouse/exterior.js';
import { buildWashing } from './clubhouse/washing.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildProps } from './assets51to100/propPlacement.js';
import {
  ensureDebris, debrisState, seedDebris, sweepAt, collectAt, suckAt, totalDebris,
} from '../sim/cleaningDebris.js';
import {
  ensureWet, wetAt, solutionAt, solutionLevel, consumeSolution, dryTick, SOLUTION_MIN,
  wetGridForRoom,
} from '../sim/cleaningWet.js';
import { CLEANING_TOOLS, TOOL_CLASS } from '../data/cleaningTools.js';
import {
  planOrganicOrder, reconcileCustomerItemMeshes,
  createSequentialPlacement, createSequentialPlacementRecovery, stepSequentialPlacement,
  createCustomerImpatientBeat, stepCustomerImpatientBeat,
} from './clubhouse/customerFlow.js';
import {
  PAID_BAG_ACCEPTANCE_HOLD_SEC, attachPaidBagToCustomer, syncPaidBagCarry,
} from './clubhouse/customerPaidBag.js';
import { placedFixtures, ensureLayout } from '../sim/layout.js';
import {
  boxPlacementCapabilities,
  boxPlacementDimensions,
  boxPlacementSurfaces,
  boxesOnSurface,
  previewBoxPlacement,
  resolveBoxPose,
  snapBoxPlacementTarget,
} from '../sim/boxPlacement.js';
import { buildBuildMode } from './clubhouse/buildMode.js';
import { createBoxPlacementMode } from './clubhouse/boxPlacementMode.js';
import {
  placementPreviewWorldPose,
  raycastBoxPlacementSurface,
  surfaceWorldPlane,
} from './clubhouse/boxPlacementCoordinates.js';
import { reviewFor, postReview } from '../sim/reviews.js';
import {
  createCheckoutFlow, transitionCheckout, enterCheckoutRecovery, checkoutStateTimedOut,
  recoverTimedOutCheckout, resumeCheckout,
} from '../sim/registerFlow.js';

const CAT_COLORS = {
  balls: 0xf3f0e4,
  accessories: 0xc9a55a,
  apparel: 0x7f9fc2,
  clubs: 0x9a8265,
  provisions: 0x78957e,
};

function carriedGoodsProfile(sku, descriptor) {
  if (sku.cat === 'clubs') return 'long-clubs';
  if (descriptor.kind === 'stand-bag') return 'bulky-stand-bag';
  if (descriptor.kind === 'water-bottle') return 'bottle-bundle';
  if (descriptor.kind === 'shoe-box') return 'shoe-box-stack';
  if (descriptor.kind === 'ball-box') return 'ball-carton-stack';
  if (descriptor.kind === 'umbrella') return 'long-accessories';
  if (['tee-pouch', 'marker-card', 'glove', 'snack-pouch'].includes(descriptor.kind)) {
    return 'small-merch-fan';
  }
  if (sku.cat === 'apparel') return 'apparel-stack';
  if (descriptor.separateHandoff || descriptor.kind.startsWith('packed-')) return 'bulky-single';
  return 'compact-merchandise';
}

function positionCarriedCatalogProduct(item, descriptor, profile, index, count) {
  if (profile === 'long-clubs') {
    // Preserve the authored club carry: two complete sale products, with their
    // heads and grips offset just enough to read as separate clubs.
    item.position.set(0, index * 0.072, (index - 0.5) * 0.036);
    item.scale.multiplyScalar(0.92);
    return;
  }
  if (profile === 'apparel-stack') {
    // Preserve the existing folded-garment bundle.
    const col = index % 2;
    const row = Math.floor(index / 2);
    item.position.set((col - 0.5) * 0.22, row * 0.085, row * 0.012);
    item.rotation.y = index % 2 ? 0.08 : -0.05;
    item.scale.multiplyScalar(0.92);
    return;
  }
  if (profile === 'shoe-box-stack') {
    const centered = index - (count - 1) / 2;
    item.position.set(centered * 0.012, index * 0.088, index * 0.012);
    item.rotation.y = centered * 0.045;
    item.scale.multiplyScalar(0.72);
    return;
  }
  if (profile === 'ball-carton-stack') {
    const col = index % 3;
    const row = Math.floor(index / 3);
    item.position.set((col - 1) * 0.122, row * 0.058, row * 0.014);
    item.rotation.y = (col - 1) * 0.03;
    item.scale.multiplyScalar(0.76);
    return;
  }
  if (profile === 'small-merch-fan') {
    const centered = index - (count - 1) / 2;
    item.position.set(centered * 0.043, Math.abs(centered) * 0.006, index * 0.007);
    item.rotation.z = centered * -0.065;
    item.scale.multiplyScalar(0.76);
    return;
  }
  if (profile === 'bottle-bundle') {
    const col = index % 3;
    const row = Math.floor(index / 3);
    item.position.set((col - 1) * 0.065, row * 0.015, row * 0.060);
    item.rotation.y = (col - 1) * 0.065;
    item.scale.multiplyScalar(0.76);
    return;
  }
  if (profile === 'bulky-stand-bag') {
    // Catalog stand bags rest along X. Rotate the single full silhouette upright
    // and lift around its midpoint so the body, pockets and legs stay in frame.
    item.position.set(0.02, 0.28, 0);
    item.rotation.z = -Math.PI / 2;
    item.scale.multiplyScalar(0.70);
    return;
  }
  if (profile === 'long-accessories') {
    item.position.set(0, index * 0.038, (index - (count - 1) / 2) * 0.028);
    item.rotation.y = (index - (count - 1) / 2) * 0.025;
    item.scale.multiplyScalar(0.76);
    return;
  }
  if (profile === 'bulky-single') {
    item.position.y = Math.max(0, (descriptor.size?.[1] || 0) * 0.08);
    item.scale.multiplyScalar(0.82);
    return;
  }

  const columns = descriptor.size?.[0] > 0.18 ? 2 : 3;
  const col = index % columns;
  const row = Math.floor(index / columns);
  item.position.set((col - (columns - 1) / 2) * 0.17, row * 0.11, row * 0.025);
  item.rotation.y = (col - (columns - 1) / 2) * 0.07;
  item.scale.multiplyScalar(0.86);
}

const CARRIED_GOODS_CAMERA_POSES = Object.freeze({
  'long-clubs': Object.freeze({ position: Object.freeze([0, -0.38, -1.06]), rotation: Object.freeze([0.05, 0.06, -0.20]) }),
  'bulky-stand-bag': Object.freeze({ position: Object.freeze([0.34, -0.58, -1.18]), rotation: Object.freeze([0.08, -0.18, 0.16]) }),
  'bulky-single': Object.freeze({ position: Object.freeze([0.28, -0.54, -1.16]), rotation: Object.freeze([0.06, -0.14, 0.10]) }),
  'long-accessories': Object.freeze({ position: Object.freeze([0, -0.42, -1.04]), rotation: Object.freeze([0.08, 0.04, -0.14]) }),
  'bottle-bundle': Object.freeze({ position: Object.freeze([0.10, -0.46, -0.98]), rotation: Object.freeze([0.16, 0.02, -0.03]) }),
  'shoe-box-stack': Object.freeze({ position: Object.freeze([0.10, -0.46, -1.02]), rotation: Object.freeze([0.16, 0.02, -0.02]) }),
  'ball-carton-stack': Object.freeze({ position: Object.freeze([0.10, -0.42, -0.96]), rotation: Object.freeze([0.18, 0.02, -0.02]) }),
  'small-merch-fan': Object.freeze({ position: Object.freeze([0.10, -0.39, -0.94]), rotation: Object.freeze([0.18, 0.02, -0.02]) }),
  default: Object.freeze({ position: Object.freeze([0.10, -0.40, -0.92]), rotation: Object.freeze([0.18, 0.02, -0.02]) }),
});

export function carriedGoodsCameraPose(profile) {
  const pose = CARRIED_GOODS_CAMERA_POSES[profile] || CARRIED_GOODS_CAMERA_POSES.default;
  return {
    position: [...pose.position],
    rotation: [...pose.rotation],
  };
}

// Camera-carried stock uses the same catalog product builder as cartons, shelves
// and checkout. The lone cube path is deliberately marked and reserved for a
// genuinely unknown save/mod SKU, where retaining a visible object is safer than
// dropping owned inventory from the player's hands.
export function makeGoodsMesh(carry, {
  merch = null,
  mats = null,
  resources = createOwnedStockResources(),
} = {}) {
  const root = new THREE.Group();
  const skuId = carry?.skuId || 'unknown';
  root.name = `CarriedGoods_${skuId}`;
  root.userData.deliveryOwnedResources = resources;
  root.userData.carriedSkuId = skuId;

  const sku = SHOP_CATALOG.find((entry) => entry.id === skuId);
  const requestedCount = Math.max(0, Math.floor(Number(carry?.qty) || 0));
  if (!sku) {
    root.userData.catalogSkuKnown = false;
    root.userData.deliveryCarryProfile = 'generic-unknown';
    const base = new THREE.Color(CAT_COLORS.accessories);
    const show = Math.min(requestedCount, 6);
    for (let index = 0; index < show; index++) {
      const color = base.clone().offsetHSL(0, 0, index % 2 ? -0.06 : 0.03);
      const material = resources.material(new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
      material.userData.deliveryOwned = true;
      const item = new THREE.Mesh(
        resources.geometry(new THREE.BoxGeometry(0.1, 0.05, 0.09)),
        material,
      );
      item.name = `GenericCarryCube_${skuId}_${String(index + 1).padStart(2, '0')}`;
      item.userData.genericCarryCube = true;
      const col = index % 3;
      const row = Math.floor(index / 3);
      item.position.set((col - 1) * 0.115, row * 0.06, row * 0.015);
      item.rotation.y = index % 2 ? 0.08 : -0.05;
      root.add(item);
    }
    return root;
  }

  const descriptor = catalogProductVisual(sku);
  const profile = carriedGoodsProfile(sku, descriptor);
  // Oversized freight and stand bags are one physical carry. All other armfuls
  // stay capped at six visible proxies, preserving the prior draw-call bound.
  const show = profile === 'bulky-single' || profile === 'bulky-stand-bag'
    ? Math.min(requestedCount, 1)
    : Math.min(requestedCount, 6);
  root.userData.catalogSkuKnown = true;
  root.userData.catalogKind = descriptor.kind;
  root.userData.deliveryCarryProfile = profile;
  root.userData.visibleProductCount = show;

  for (let index = 0; index < show; index++) {
    const built = buildCatalogProductProxy({
      sku,
      merch,
      mats,
      resources,
      context: 'stock-carry',
    });
    const item = built.root;
    // Keep buildCatalogProductProxy's canonical CheckoutProduct_<sku> name so
    // runtime census/debug tooling can prove which authored family is present.
    item.userData.carryInstanceName = `CarriedCatalogProduct_${sku.id}_${String(index + 1).padStart(2, '0')}`;
    item.userData.carriedGoodsSkuId = sku.id;
    item.userData.carriedGoodsKind = descriptor.kind;
    item.userData.carryVisualRole = 'catalog-product-proxy';
    positionCarriedCatalogProduct(item, descriptor, profile, index, show);
    root.add(item);
  }
  return root;
}

const FLOOR_TOP = 0.3; // interior floor (and porch deck) height over the terrain base
export const CLUBHOUSE_INTERIOR_DRAW_DISTANCE = 80;
export const CLUBHOUSE_GTAO_EXCLUSION_CLEARANCE_YD = 15;
// The east pallet in row one has an unobstructed authored +Z approach. Its
// persisted padPalletIndex remains the authority for which saved cartons move.
const DELIVERY_PALLET_JACK_COUPLED_INDEX = 2;

const DELIVERY_VAN_REAR_LOADING_ANCHOR = 'REAR_LOADING_ANCHOR';
const DELIVERY_VAN_BOX_TRANSFER_SECONDS = 1.35;
const DELIVERY_VAN_BOX_TRANSFER_STAGGER = 0.11;

function deliveryBoxIdCompare(a, b) {
  const an = Number(a?.id);
  const bn = Number(b?.id);
  if (Number.isSafeInteger(an) && Number.isSafeInteger(bn)) return an - bn;
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''), undefined, { numeric: true });
}

// Compatibility view retained for focused renderer tests and diagnostics. The
// data planner owns the physical volume, dimensions, support and overflow
// policy; this helper simply exposes its first numbered van load.
export function planPendingDeliveryVanCargo(boxes) {
  return planDeliveryVanCargo(Array.isArray(boxes) ? boxes.filter(Boolean) : [])
    .loads[0]?.placements || [];
}

// Compatibility rest summary. Shipping-safe orientations are defined once in
// the pure cargo planner and consumed by both tests and runtime mounting.
export function deliveryVanCargoRestPose(kind) {
  const id = typeof kind === 'string' ? kind : kind?.id;
  const orientation = deliveryVanCargoOrientations(id)[0];
  return Object.freeze({
    profile: orientation.profile,
    rotationX: orientation.euler.x,
    rotationY: orientation.euler.y,
    rotationZ: orientation.euler.z,
    packedHeight: orientation.orientedDimensions.y,
    footprintLength: orientation.orientedDimensions.x,
    footprintWidth: orientation.orientedDimensions.z,
  });
}

// Allocation-free interior test shared by normal clubhouse checks and the
// grass exclusion margin. The margin is deliberately an axial five-probe
// union, not a rectangular expansion: diagonal corner points remain outside,
// exactly as they did when the grass loop called isInside five times.
export function pointInsideClubhouseInterior(
  wx,
  wz,
  centerX,
  centerZ,
  halfWidth,
  halfDepth,
  axialMargin = 0,
) {
  const localX = wx - centerX;
  const localZ = wz - centerZ;
  const insideX = Math.abs(localX) < halfWidth;
  const insideZ = Math.abs(localZ) < halfDepth;
  if (insideX && insideZ) return true;
  if (axialMargin === 0) return false;
  return (insideZ && Math.abs((wx + axialMargin) - centerX) < halfWidth)
    || (insideZ && Math.abs((wx - axialMargin) - centerX) < halfWidth)
    || (insideX && Math.abs((wz + axialMargin) - centerZ) < halfDepth)
    || (insideX && Math.abs((wz - axialMargin) - centerZ) < halfDepth);
}

export function clubhouseInteriorVisibleAt(
  cameraX,
  cameraZ,
  centerX,
  centerZ,
  maxDistance = CLUBHOUSE_INTERIOR_DRAW_DISTANCE,
) {
  return Math.hypot(cameraX - centerX, cameraZ - centerZ) < maxDistance;
}

// The beauty pass keeps the furnished interior visible through the clubhouse
// windows. At accepted distant exterior viewpoints, however, measurements show
// no visible contribution from redrawing all of those covered meshes into
// GTAO's depth/normal buffers. Measure clearance from the interior footprint
// (rather than its centre) so checkout, the porch and the normal walk spawn
// retain indoor AO.
export function clubhouseInteriorGtaoExcludedAt(
  cameraX,
  cameraZ,
  centerX,
  centerZ,
  minClearance = CLUBHOUSE_GTAO_EXCLUSION_CLEARANCE_YD,
) {
  if (![cameraX, cameraZ, centerX, centerZ, minClearance].every(Number.isFinite)
    || minClearance < 0) return false;
  const dx = Math.max(Math.abs(cameraX - centerX) - INTERIOR.w / 2, 0);
  const dz = Math.max(Math.abs(cameraZ - centerZ) - INTERIOR.d / 2, 0);
  return Math.hypot(dx, dz) >= minClearance;
}

// Resolve a logical inventory slot against a named transform authored inside
// the loaded fixture GLB. Static coordinates remain the immediate-load fallback
// and the input object is never mutated, so save/stock logic stays model-agnostic.
export function resolveAuthoredFixtureSlot(anchor, slot) {
  if (!anchor || !slot?.socketName) return slot;
  const socket = anchor.getObjectByName(slot.socketName);
  if (!socket) return slot;
  anchor.updateWorldMatrix(true, true);
  const point = socket.getWorldPosition(new THREE.Vector3());
  anchor.worldToLocal(point);
  if (slot.socketOffset) {
    point.x += Number(slot.socketOffset.x) || 0;
    point.y += Number(slot.socketOffset.y) || 0;
    point.z += Number(slot.socketOffset.z) || 0;
  }
  return { ...slot, x: point.x, y: point.y, z: point.z };
}

export function makeClubhouse(ctx) {
  // ctx: { scene, camera, state, center:{x,z}, heightAt, walkProps, propColliders, walk, hooks }
  const {
    scene, camera, renderer, state, center, heightAt, walkProps, propColliders, walk, hooks,
  } = ctx;
  // Course resources already resident when this clubhouse is built can be
  // referenced by its Object3D tree, but remain owned by the course. Everything
  // new beneath the clubhouse roots is released on a structure rebuild.
  const protectedRenderableResources = collectRenderableResources([scene, camera]);
  const baseY = heightAt(center.x, center.z);
  const floorY = baseY + FLOOR_TOP;

  const group = new THREE.Group();          // shell: walls, roof, porch — always visible
  group.position.set(center.x, baseY, center.z);
  const interior = new THREE.Group();       // fixtures, stock, grime, decor — distance-gated
  interior.position.set(center.x, floorY, center.z);
  // Indoor contents sit under the roof — the sun cannot reach them, so casting
  // into the world sun-shadow map produces physically-wrong shadows AND bloats
  // the 10 Hz shadow bake (measured ~27% of it, 1300+ caster meshes). Contact
  // shadows still come from GTAO. Strip castShadow from everything added to the
  // interior; the building SHELL (group) keeps casting so the clubhouse still
  // shadows the course. Wrapping add() catches async-loaded kit models too.
  const _interiorAdd = interior.add.bind(interior);
  interior.add = (...objs) => {
    for (const object of objs) suppressInteriorSunShadows(object);
    return _interiorAdd(...objs);
  };
  const custGroup = new THREE.Group();      // customers walk in WORLD space (they go outside)
  scene.add(group, interior, custGroup);

  const L2W = (lx, lz) => ({ x: center.x + lx, z: center.z + lz });
  const W2L = (wx, wz) => ({ x: wx - center.x, z: wz - center.z });
  const interiorHalfWidth = INTERIOR.w / 2;
  const interiorHalfDepth = INTERIOR.d / 2;
  const isInside = (wx, wz, axialMargin = 0) => pointInsideClubhouseInterior(
    wx, wz, center.x, center.z, interiorHalfWidth, interiorHalfDepth, axialMargin,
  );
  const onPorch = (wx, wz) => {
    const l = W2L(wx, wz);
    return Math.abs(l.x) < SHELL.w * 0.35 && l.z >= INTERIOR.d / 2 && l.z <= SHELL.d / 2 + SHELL.porchD;
  };
  const legacyGroundYAt = (wx, wz) => (isInside(wx, wz) || onPorch(wx, wz) ? floorY : null);

  // every collider registers in BOTH the player's shared list and the local
  // customer list; dynamic ones (doors, clutter, decor) toggle through these
  const custCols = [];
  const registeredProps = [];
  const registeredCols = [];
  let colVersion = 0; // customers' nav grid rebakes when the collider world changes
  function addCol(col) {
    propColliders.push(col);
    custCols.push(col);
    registeredCols.push(col);
    colVersion++;
    return col;
  }
  function removeCol(col) {
    for (const arr of [propColliders, custCols, registeredCols]) {
      const i = arr.indexOf(col);
      if (i >= 0) arr.splice(i, 1);
    }
    colVersion++;
  }
  const sheet06Navigation = createSheet06NavigationContract({
    centerX: center.x,
    centerZ: center.z,
    floorY,
    terrainHeightAt: heightAt,
    addCollider: addCol,
    removeCollider: removeCol,
  });
  const groundYAt = (wx, wz) => sheet06Navigation.groundYAt(
    wx, wz, legacyGroundYAt(wx, wz),
  );
  function addProp(p) {
    walkProps.push(p);
    registeredProps.push(p);
    return p;
  }
  function removeProp(p) {
    for (const arr of [walkProps, registeredProps]) {
      const i = arr.indexOf(p);
      if (i >= 0) arr.splice(i, 1);
    }
  }
  const colBoxAt = (lx, lz, w, d) => {
    const p = L2W(lx, lz);
    return { minX: p.x - w / 2, maxX: p.x + w / 2, minZ: p.z - d / 2, maxZ: p.z + d / 2 };
  };

  // --- materials + the building shell (clubhouse/materials.js + clubhouse/shell.js) ------
  const mats = makeClubhouseMaterials((state && state.clubName) || 'The Club');
  const materialKitResources = collectMaterialResources(mats);
  function disposeClubhouseFallback(root) {
    if (!root) return;
    root.removeFromParent();
    disposeRenderableResources(collectRenderableResources(root), materialKitResources);
  }
  // The Blender-authored goods. They arrive after the shop is built, so the shop
  // restocks once they land — a shelf that is briefly bare beats one permanently
  // made of boxes. The restock hook is registered at the END of the build, not
  // here: a GLB that fails fast can call back before this function has finished
  // running, and rebuildStock() closes over state declared further down (it hit
  // exactly that dead zone once).
  const merch = createMerch(mats);
  let deliveryPadSurfaceY = null;
  let deliveryVanBaySurfaceY = null;
  let deliveryVanBayBounds = null;
  let deliveryPalletStage = null;
  let coupledDeliveryPalletAnchor = null;
  let coupledDeliveryPalletAssetRoot = null;
  let coupledDeliveryPalletCollider = null;
  let coupledDeliveryPalletLiftOffset = 0;
  // legacy aliases: sections still awaiting their v2 pass draw from the kit
  const woodMat = mats.walnut;
  const darkMat = mats.walnutDark;
  const railMat = mats.walnut;
  const trimMat = mats.trimPaint;
  const glassMat = mats.glass;
  const halfW = SHELL.w / 2 - SHELL.wallT / 2; // wall centerlines
  const halfD = SHELL.d / 2 - SHELL.wallT / 2;

  const B = {
    ctx, state, group, interior, custGroup, mats, merch, hooks, walk,
    addCol, removeCol, addProp, removeProp, colBoxAt, L2W, W2L, FLOOR_TOP,
    getCustomers: () => customers,
  };
  const shell = buildShell(B);

  // --- grime + window film (clubhouse/dirt.js — art-directed, state-masked) --------------
  B.onWindowDirt = () => shell.lighting.setWindowDirt(windowDirtAvg(state));
  const dirt = buildDirt(B, shell.windowDefs);
  const repaintGrime = dirt.repaintGrime;
  B.onWindowDirt();

  // Welcome mat inside the door.
  //
  // A canvas stand-in. Asset 100 is the authored version of this exact object, so the prop
  // placement table disposes this once it lands — two mats on one threshold z-fight.
  {
    const matCv = document.createElement('canvas');
    matCv.width = 128; matCv.height = 64;
    const mc = matCv.getContext('2d');
    mc.fillStyle = '#5a4a33'; mc.fillRect(0, 0, 128, 64);
    mc.strokeStyle = '#8a7a5c'; mc.lineWidth = 5; mc.strokeRect(6, 6, 116, 52);
    mc.fillStyle = '#8a7a5c'; mc.font = 'bold 20px Georgia'; mc.textAlign = 'center';
    mc.fillText('WELCOME', 64, 40);
    const matTex = new THREE.CanvasTexture(matCv);
    matTex.colorSpace = THREE.SRGBColorSpace;
    const matMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 1.0),
      new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.95 }),
    );
    matMesh.rotation.x = -Math.PI / 2;
    matMesh.position.set(MAT.x, 0.016, MAT.z);
    matMesh.renderOrder = 1;
    matMesh.name = 'LegacyWelcomeMat';
    interior.add(matMesh);
  }

  // --- doors + interior lighting (clubhouse/doors.js + the shell rig) --------------------
  const doorsApi = buildDoors(B);
  const doors = doorsApi.doors;
  const updateDoors = doorsApi.updateDoors;
  const sheet06Production = createSheet06ProductionRuntime({
    group,
    interior,
    state,
    shellFallbacks: shell.productionVisualFallbacks,
    doorApi: doorsApi,
    navigationApi: sheet06Navigation,
  });
  // Assets 71-100: thirty finished props that nothing was loading. Static dressing, so they skip
  // the Sheet 6 production machinery entirely and just get placed — each aligned by its own
  // SOCKET_PLACEMENT rather than by its authoring origin.
  const props71to100 = buildProps({ interior, loader: new GLTFLoader() });

  const sheet06ProductionPublic = Object.freeze({
    ready: sheet06Production.ready,
    diagnostics: () => sheet06Production.diagnostics(),
    getRoot: (number) => sheet06Production.getRoot(number),
    getAssemblyRoot: (number) => sheet06Production.getAssemblyRoot(number),
  });
  buildExterior(B); // yard neglect + physical repair verbs (clubhouse/exterior.js)
  const washing = buildWashing(B); // exterior grime: a mask you erode with the jet, not an [E] verb
  scene.add(washing.jet, washing.mist);

  let conditionNow = 100;
  function refreshCondition() {
    conditionNow = state && state.shop ? shopCondition(state) : 100;
    shell.lighting.refreshCondition(conditionNow);
  }
  const updateFlicker = (dt) => shell.lighting.updateFlicker(dt);

  // --- fixtures, lounge, stockroom dressing (clubhouse/fixtures.js) ----------------------
  B.rebuildStock = (...a) => rebuildStock(...a); // function is hoisted; wired before use
  const {
    fixtureAnchors,
    relayFixtures,
    setFixtureCollidersActive,
    fixtureColliderDiagnostics,
  } = buildFixtures(B);

  function fixtureBrowsePose(fixture, localX = 0, localZ = null) {
    const local = fixtureBrowsePoint(fixture, localX, localZ);
    const target = L2W(local.x, local.z);
    const origin = L2W(fixture.x, fixture.z);
    return {
      x: target.x,
      z: target.z,
      faceX: origin.x,
      faceZ: origin.z,
    };
  }

  function retargetCustomerFixtureStops() {
    const fixtures = new Map(placedFixtures(state).map((fixture) => [fixture.id, fixture]));
    for (const customer of customers) {
      let currentChanged = false;
      const kept = [];
      for (let index = 0; index < customer.stops.length; index++) {
        const stop = customer.stops[index];
        if (index < customer.stopIdx || stop.kind !== 'fixture' || !stop.fixtureId) {
          kept.push(stop);
          continue;
        }
        const fixture = fixtures.get(stop.fixtureId);
        if (!fixture) {
          if (index === customer.stopIdx) currentChanged = true;
          continue;
        }
        const pose = fixtureBrowsePose(fixture, stop.fixtureLocalX, stop.fixtureLocalZ);
        if (index === customer.stopIdx
          && Math.hypot(stop.x - pose.x, stop.z - pose.z) > 1e-6) currentChanged = true;
        Object.assign(stop, pose, {
          skus: fixture.skus,
          title: fixture.title,
        });
        kept.push(stop);
      }
      customer.stops = kept;
      if (currentChanged) {
        customer.path = [];
        customer.pathGoal = null;
        customer.stuckT = 0;
        customer.repathed = false;
      }
    }
  }

  // the player moved something: re-lay the floor and put the stock back on it. The customers'
  // paths rebake themselves — removeCol/addCol bump colVersion, and navFresh() watches it — so a
  // shelf that moved is a wall that moved, as far as they are concerned.
  function rebuildLayout() {
    relayFixtures();
    retargetCustomerFixtureStops();
    rebuildStock();
    rebuildBoxes();
  }

  function fixtureMoveBlocker(fixtureId) {
    const occupied = boxPlacementSurfaces(state)
      .filter((surface) => surface.parent?.kind === 'fixture' && surface.parent.id === fixtureId)
      .flatMap((surface) => boxesOnSurface(state, surface.id));
    if (!occupied.length) return null;
    return {
      boxId: occupied[0].id,
      reason: `Move the delivery carton off ${occupied[0].surfaceId ? 'this fixture' : 'the fixture'} first.`,
    };
  }

  // build mode needs the anchors it is going to hide and the re-lay it is going to trigger, so it
  // is built here rather than up with the rest of the scene
  const hiddenFixtureStock = new Set();
  const setFixtureStockVisible = (fixtureId, visible) => {
    if (visible) hiddenFixtureStock.delete(fixtureId);
    else hiddenFixtureStock.add(fixtureId);
    const prefix = `${fixtureId}:`;
    for (const [key, stock] of stockMeshes) {
      if (key.startsWith(prefix)) stock.visible = visible;
    }
    for (const flight of stockFlights) {
      if (flight.fixtureId === fixtureId) flight.ghost.visible = visible;
    }
  };
  const builder = buildBuildMode(B, {
    rebuildLayout,
    fixtureAnchors,
    fixtureMoveBlocker,
    setFixtureStockVisible,
    setFixtureCollidersActive,
    fixtureColliderDiagnostics,
  });
  buildLounge(B);
  buildStockroomDressing(B);

  // --- THE REGISTER ---------------------------------------------------------------------
  // The old checkout lived here: one addProp with a context-sensitive [E] that scanned
  // an item, then totalled up, then ran the card, then cycled a change amount, with [R]
  // to confirm. Every verb was the same key on the same invisible trigger, and nothing
  // on the counter ever moved. All of that is gone. clubhouse/registerMode.js owns the
  // counter now, and it owns it PHYSICALLY.
  //
  // What is left here is the join: a customer reaching the head of the queue starts a
  // transaction, standing at the counter offers [E] to step into it, and a customer who
  // walks out takes their goods back to the shelf.
  const register = createRegisterMode(B);
  B.register = register;

  const flowNow = () => performance.now();
  function syncCustomerCheckoutFlow(c, flow) {
    if (!c || !flow) return false;
    c.checkoutFlow = flow;
    if (c.tx) c.tx.checkoutFlow = flow;
    return true;
  }

  function advanceCustomerCheckout(c, next, event) {
    if (!c) return false;
    if (!c.checkoutFlow) c.checkoutFlow = createCheckoutFlow({ nowMs: flowNow() });
    const moved = transitionCheckout(c.checkoutFlow, next, { nowMs: flowNow(), event });
    if (!moved.ok) return false;
    syncCustomerCheckoutFlow(c, moved.flow);
    return true;
  }

  const checkout = buildCheckout(B);
  const drawRegister = checkout.drawRegister;

  const regWp = L2W(REGISTER.scanner.x, COUNTER.z);

  // what this customer's day was actually like — the only thing a review is allowed to read
  const visitOf = (c, bought) => ({
    waitedSec: c.queuedAt ? Math.max(0, now - c.queuedAt) : 0,
    queueLen: c.queueLenOnArrival || 0,
    bought,
    played: !!c.isGolfer,
    foundWhatTheyWanted: bought,
  });
  const leaveReview = (c, bought) => {
    if (c.reviewed) return null;
    c.reviewed = true;
    const r = reviewFor(state, visitOf(c, bought), Math.round((c.seed || 0) * 1000 + (state.dayAbs || 0)));
    postReview(state, r);
    return r;
  };

  // the head of the queue, with goods, waiting on YOU
  const headForCheckout = () => {
    const c = counterQueue[0];
    return c && c.cart && c.cart.length && c.awaitingCheckout ? c : null;
  };

  function attachOversizePurchaseVisuals(c, transaction) {
    const oversize = (transaction && transaction.items ? transaction.items : [])
      .map((item) => ({ item, sku: SHOP_CATALOG.find((sku) => sku.id === item.skuId) }))
      .filter(({ sku }) => catalogProductVisual(sku).separateHandoff);
    if (!oversize.length) return null;
    const carry = new THREE.Group();
    carry.name = 'PaidOversizeCarryRoot';
    c.mesh.add(carry);
    c.oversizeCarryRoot = carry;
    oversize.forEach(({ item, sku }, index) => {
      const built = buildCatalogProductProxy({
        sku,
        merch,
        mats,
        resources: c.checkoutProductResources,
      });
      const product = built.root;
      // Checkout models rest along X. Turn them upright along the customer's free
      // side for departure; unlike the paper carrier they remain full-scale.
      product.position.set(-0.30 - index * 0.08, 1.24 + index * 0.05, 0.12 - index * 0.06);
      product.rotation.set(0, -0.10 + index * 0.08, -Math.PI / 2);
      product.userData.checkoutOwner = 'customer';
      product.userData.checkoutUid = item.uid;
      carry.add(product);
    });
    return carry;
  }

  function disposeCustomerHandoffReceipt(c) {
    const receipt = c?.handoffReceipt;
    if (!receipt) return false;
    receipt.removeFromParent();
    if (receipt.userData?.checkoutOwnedReceipt && receipt.geometry) receipt.geometry.dispose();
    const materials = Array.isArray(receipt.material) ? receipt.material : [receipt.material];
    for (const material of new Set(materials)) {
      if (!material || !receipt.userData?.checkoutOwnedReceipt) continue;
      if (material.map) material.map.dispose();
      material.dispose();
    }
    c.handoffReceipt = null;
    return true;
  }

  // The sale banked. registerMode calls this through cust.onPaid, because IT owns the
  // money and the goods, and clubhouse.js owns the person.
  function onCustomerPaid(c, transaction = null) {
    const acceptanceYaw = c.mesh.rotation.y;
    c.bought = true;
    c.paymentStatus = 'paid';
    if (!c.visitRecorded && c.customerId) {
      recordCustomerVisit(state, c.customerId, {
        dayAbs: Math.floor(state.clock.minutes / 1440),
        purpose: 'retail',
        outcome: 'purchase',
        paymentMethod: transaction && transaction.method,
        amount: transaction ? totalOf(transaction) : 0,
      });
      c.visitRecorded = true;
    }
    leaveReview(c, true);
    clearCustomerItemMeshes(c);
    // FINALIZE is the ownership boundary: only after the sale banks do the
    // branded carrier, receipt, and any oversize goods attach to the customer.
    // This keeps unpaid props at the counter while ensuring paid goods remain
    // visibly theirs through the acceptance beat and walk out.
    // a branded carrier into their hand — they walk out with it
    const handedBag = c.checkoutHandoffBag || null;
    const kitBag = !handedBag && merch?.instantiateKit
      ? merch.instantiateKit('shopping_bag', { scale: 0.86 })
      : null;
    const legacyBag = !handedBag && !kitBag && merch
      ? merch.instantiate('checkout_shopping_bag') : null;
    const bag = handedBag || kitBag || legacyBag || new THREE.Group();
    const productionBag = !!(handedBag || kitBag || legacyBag);
    if (!productionBag) {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.26, 0.13),
        new THREE.MeshStandardMaterial({ color: 0x2e5a3a, roughness: 0.85 }),
      );
      body.position.y = 0.13;
      bag.add(body);
    } else if (legacyBag) {
      // A believable 26 cm retail carrier: large enough for the three-item sale
      // and readable as the object the customer owns in the departure shot.
      bag.scale.setScalar(0.78);
    }
    const paidReceipt = !c.handoffReceipt && merch && merch.instantiateKit
      ? merch.instantiateKit('loose_receipt', { scale: 0.78 })
      : null;
    if (paidReceipt) {
      const pocket = bag.getObjectByName('ANCHOR_ReceiptPocket');
      const receiptParent = pocket || bag;
      paidReceipt.position.set(0, 0, 0);
      if (!pocket) paidReceipt.position.set(0.07, 0.30, -0.045);
      paidReceipt.rotation.set(-0.16, 0.08, 0.04);
      paidReceipt.userData.checkoutOwner = 'customer';
      receiptParent.add(paidReceipt);
    }
    const char = c.mesh.userData.char;
    const hand = char && char.hand ? char.hand('L') : null;
    const authoredGrip = char && char.carryGrip ? char.carryGrip('L') : null;
    // The dedicated grip is a scale-independent sibling of the hand mesh. It
    // supplies the carry point without applying the hand ellipsoid's non-uniform
    // scale. The upright carrier follows that point but not the forearm's pitch,
    // so gravity keeps the bag vertical while the articulated arm moves.
    const carryTarget = authoredGrip || hand;
    c.bagAcceptanceHold = PAID_BAG_ACCEPTANCE_HOLD_SEC;
    c.bagAcceptanceYaw = acceptanceYaw;
    attachPaidBagToCustomer(c, bag, { productionBag, carryTarget });
    c.checkoutHandoffBag = null;
    attachOversizePurchaseVisuals(c, transaction);
    // Preserve the orientation established by the physical handoff camera for the
    // short ownership beat. Turning toward the scanner here made the customer and
    // branded bag snap edge-on before the player could read the transfer; normal
    // route locomotion takes over as soon as the acceptance hold expires.
    c.bagAcceptanceFace = null;
    if (char) char.setMode('ReceiveBag');
    c.cart = [];
    c.awaitingCheckout = false;
    c.checkoutPhase = 'complete';
    leaveQueue(c);
    c.stopIdx += 1;
    c.linger = 0;
    rebuildStock(); // the shelf gap where their pick came from stays real
  }

  addProp({
    x: regWp.x, z: regWp.z, r: 2.2,
    label: () => {
      const deskCustomer = counterQueue[0];
      if (deskCustomer && deskCustomer.checkoutPhase === 'walk-in-waiting') {
        return `Front desk - [E] help ${deskCustomer.fullName} choose a walk-in tee time`;
      }
      if (deskCustomer && deskCustomer.reservationId != null
          && deskCustomer.checkoutPhase === 'reservation-waiting') {
        const reservation = reservationRecordForCustomer(deskCustomer);
        if (reservation) {
          return `Front desk - [E] check in ${deskCustomer.fullName} (${fmtSlot(reservation.minute)} tee)`;
        }
      }
      const due = dueForCheckIn(state);
      if (due.length) {
        const r = due[0];
        return `Register — [E] check in ${r.name} (${fmtSlot(r.minute)} tee, ${Math.round(r.fee)} dollars)`
          + (due.length > 1 ? ` · ${due.length - 1} more waiting` : '');
      }
      const l = register.label();
      if (l) return l;
      const s = state.shop;
      const live = s.salesLive && s.salesLive.units ? ` · today at the counter: ${s.salesLive.units} rung up` : '';
      return `Register — yesterday: ${s.salesYesterday.units} sales, ${s.salesYesterday.revenue} dollars${live}`;
    },
    action: () => {
      // The shared monitor owns selection and never mutates a reservation merely
      // because the player pressed E near the counter.
      if (register.enter() || register.isActive()) return;
      if (hooks.toast) hooks.toast('The front desk is unavailable.', 'warn');
    },
  });

  // [R] is gone as a checkout verb — the change goes into a hand now, not into a
  // keypress. The API keeps the name so main.js does not have to care.
  const regConfirmChange = () => false;

  {

    // THE CREST PANEL behind the counter. This was the club's name and three flat
    // triangles PAINTED DIRECTLY ON THE PLASTER as a transparent decal, and it was
    // the loudest placeholder left in the room: a wall wordmark reads as a decal
    // because that is exactly what it was. Ref 4 has an architectural feature —
    // a cream field set in a walnut surround, standing proud of the wall, lit from
    // above by its own picture light. That is what this is now.
    // The wall behind the counter is not free: the back-counter hutch runs up to
    // y 2.27 and the ceiling is at 3.2, so there is 0.9 yd of wall to work with.
    // A tall portrait panel simply hid behind the shelves. This is a wide sign
    // board above them — which is what ref 4 actually shows.
    const logoCanvas = document.createElement('canvas');
    logoCanvas.width = 1024;
    logoCanvas.height = 288;
    const logoTex = new THREE.CanvasTexture(logoCanvas);
    logoTex.colorSpace = THREE.SRGBColorSpace;

    const crest = new THREE.Group();
    crest.position.set(COUNTER.x, 2.74, INTERIOR.d / 2 - 0.02);
    crest.rotation.y = Math.PI;

    const PW = 2.90;
    const PH = 0.80;
    // walnut surround: a backer with real thickness, plus four mitered rails
    const backer = new THREE.Mesh(roundedBox(PW + 0.22, PH + 0.22, 0.07, 0.015), mats.walnut);
    backer.position.z = -0.035;
    backer.castShadow = true;
    crest.add(backer);
    for (const [w, h, px, py] of [
      [PW + 0.22, 0.11, 0, (PH + 0.11) / 2], [PW + 0.22, 0.11, 0, -(PH + 0.11) / 2],
      [0.11, PH + 0.22, (PW + 0.11) / 2, 0], [0.11, PH + 0.22, -(PW + 0.11) / 2, 0],
    ]) {
      const rail = new THREE.Mesh(roundedBox(w, h, 0.06, 0.012), mats.walnutDark);
      rail.position.set(px, py, 0.01);
      crest.add(rail);
    }
    // the field itself: a lit cream panel, not a hole in the plaster
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(PW, PH),
      new THREE.MeshStandardMaterial({
        map: logoTex, roughness: 0.88,
        emissive: 0xfff0d6, emissiveMap: logoTex, emissiveIntensity: 0.28,
      }),
    );
    field.position.z = 0.005;
    crest.add(field);
    interior.add(crest);

    // its own picture light, throwing a wash down the panel
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.22, 6), mats.iron);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(COUNTER.x, 3.22, INTERIOR.d / 2 - 0.16);
    interior.add(arm);
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 0.5, 10, 1, true), mats.iron);
    hood.rotation.z = Math.PI / 2;
    hood.position.set(COUNTER.x, 3.22, INTERIOR.d / 2 - 0.27);
    hood.material.side = THREE.DoubleSide;
    interior.add(hood);
    const wash = new THREE.SpotLight(0xffe9c2, 6, 3.2, 0.8, 0.7, 1.6);
    wash.position.set(COUNTER.x, 3.18, INTERIOR.d / 2 - 0.30);
    wash.target.position.set(COUNTER.x, 2.72, INTERIOR.d / 2 - 0.05);
    interior.add(wash, wash.target);

    redrawLogoInto(logoCanvas, logoTex);
  }

  // The crest panel's face. It used to clearRect() to transparent — because it was
  // a decal stuck on the plaster. It is a real printed panel now, so it has a
  // field, a rule, and a single pine mark instead of three floating triangles.
  function redrawLogoInto(cv, tex) {
    const name = (state && state.clubName) || 'THE CLUB';
    const W = cv.width;
    const H = cv.height;
    const c2 = cv.getContext('2d');

    // aged cream field with a little tooth
    c2.fillStyle = '#f2ecdc';
    c2.fillRect(0, 0, W, H);
    let s = 991;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    for (let i = 0; i < 5000; i++) {
      c2.fillStyle = rnd() < 0.5 ? '#e6dfcb30' : '#fbf6e920';
      c2.fillRect(rnd() * W, rnd() * H, 2, 2);
    }

    // a hairline gold border, as a real sign board has
    c2.strokeStyle = '#b99a3e';
    c2.lineWidth = 3;
    c2.strokeRect(14, 14, W - 28, H - 28);

    // ONE pine on the left, drawn as stacked tiers with a trunk — a mark, not
    // three floating triangles
    const px = W * 0.135;
    const top = H * 0.18;
    c2.fillStyle = '#2c5233';
    for (let t = 0; t < 4; t++) {
      const w = 34 + t * 20;
      const y = top + t * 34;
      c2.beginPath();
      c2.moveTo(px, y);
      c2.lineTo(px - w / 2, y + 48);
      c2.lineTo(px + w / 2, y + 48);
      c2.closePath();
      c2.fill();
    }
    c2.fillRect(px - 6, top + 158, 12, 24);

    // name + sub-line to the right of the mark
    const tx = W * 0.58;
    c2.textAlign = 'center';
    c2.fillStyle = '#2c5233';
    let size = 78;
    const upper = name.toUpperCase();
    c2.font = `bold ${size}px Georgia, serif`;
    while (c2.measureText(upper).width > W * 0.68 && size > 30) {
      size -= 2;
      c2.font = `bold ${size}px Georgia, serif`;
    }
    c2.fillText(upper, tx, H * 0.52);

    c2.strokeStyle = '#b99a3e';
    c2.lineWidth = 2.5;
    c2.beginPath();
    c2.moveTo(tx - W * 0.16, H * 0.63);
    c2.lineTo(tx + W * 0.16, H * 0.63);
    c2.stroke();

    c2.fillStyle = '#6b7f68';
    c2.font = '30px Georgia, serif';
    c2.fillText('P R O   S H O P', tx, H * 0.83);
    tex.needsUpdate = true;
  }

  // office: desk, chair, filing, wall course map, calendar, and (for now) the
  // computer that opens the management desk — the real laptop lands next
  const office = { computerProp: null };
  {
    // The Sheet-04 executive desk (walnut top, two drawer pedestals, brass
    // pulls) replaces the plank desk. Its top is a real 0.75 desk height —
    // the laptop rig is self-relative, so the laptop simply sits lower.
    // Kit front (drawer faces) points +Z at ry 0; the desk faces the chair
    // to its west, so ry −π/2.
    const desk = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.95), woodMat);
    top.position.y = 0.92;
    top.castShadow = true;
    desk.add(top);
    for (const [lx, lz] of [[-0.85, -0.38], [0.85, -0.38], [-0.85, 0.38], [0.85, 0.38]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.92, 0.09), darkMat);
      leg.position.set(lx, 0.46, lz);
      desk.add(leg);
    }
    const drawers = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.8), darkMat);
    drawers.position.set(0.6, 0.35, 0);
    desk.add(drawers);
    desk.position.set(OFFICE.desk.x, 0, OFFICE.desk.z);
    desk.rotation.y = OFFICE.desk.ry;
    interior.add(desk);
    addCol(colBoxAt(OFFICE.desk.x, OFFICE.desk.z, 1.1, 2.0));
    merch.onReady(() => {
      const kitDesk = merch.instantiateKit && merch.instantiateKit('office_desk');
      if (!kitDesk) return;
      kitDesk.position.set(OFFICE.desk.x, 0, OFFICE.desk.z);
      kitDesk.rotation.y = -Math.PI / 2;
      interior.add(kitDesk);
      disposeClubhouseFallback(desk);
    });

    // task chair — the Sheet-04 kit chair (five-star base, casters, black
    // leather), facing east toward the desk. The Tripo scan is the fallback.
    merch.onReady(() => {
      const kitChair = merch.instantiateKit && merch.instantiateKit('office_chair');
      const chair = kitChair || merch.instantiateRaw('office_chair');
      if (!chair) return;
      chair.position.set(OFFICE.chair.x, 0, OFFICE.chair.z);
      chair.rotation.y = kitChair ? Math.PI / 2 : -Math.PI / 2;
      // Asset 81 is the Sheet-09 office chair, authored for this same spot. Named so the prop
      // placement table can retire this one when that lands — otherwise the office has two
      // chairs a centimetre apart, which is worse than either alone.
      chair.name = 'LegacyOfficeChair';
      interior.add(chair);
    });

    // the Sheet-04 filing cabinet against the east wall, north of the desk —
    // LEDGERS / SUPPLIERS / STAFF / COURSE, which is the office's whole job
    merch.onReady(() => {
      const filing = merch.instantiateKit && merch.instantiateKit('filing_cabinet');
      if (!filing) return;
      filing.position.set(9.92, 0, 3.4);
      filing.rotation.y = -Math.PI / 2;
      interior.add(filing);
    });
    addCol(colBoxAt(9.92, 3.4, 0.75, 0.6));

    // wall course map — a real framed board, flush on the office's south wall:
    // backing panel with thickness, mitered frame lip, map face proud of the
    // backer. Mounted on actual wall so no side ever shows a floating plane.
    const mapCanvas = document.createElement('canvas');
    mapCanvas.width = 600;
    mapCanvas.height = 400;
    const mapTex = new THREE.CanvasTexture(mapCanvas);
    mapTex.colorSpace = THREE.SRGBColorSpace;
    const mapBoard = new THREE.Group();
    mapBoard.position.set(OFFICE.map.x, 1.72, OFFICE.map.z);
    mapBoard.rotation.y = OFFICE.map.ry;
    const mapBacker = new THREE.Mesh(roundedBox(2.42, 1.68, 0.05, 0.012), mats.walnutDark);
    mapBacker.position.z = -0.025;
    mapBacker.castShadow = true;
    mapBoard.add(mapBacker);
    // frame lip (four mitered rails proud of the face)
    const lipMat = mats.walnut;
    for (const [w, h, px, py] of [
      [2.42, 0.07, 0, 0.805], [2.42, 0.07, 0, -0.805],
      [0.07, 1.68, 1.175, 0], [0.07, 1.68, -1.175, 0],
    ]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.045), lipMat);
      rail.position.set(px, py, 0.012);
      mapBoard.add(rail);
    }
    const courseMap = new THREE.Mesh(
      new THREE.PlaneGeometry(2.24, 1.5),
      new THREE.MeshStandardMaterial({ map: mapTex, roughness: 0.85 }),
    );
    courseMap.position.z = 0.003;
    mapBoard.add(courseMap);
    interior.add(mapBoard);
    const MAP_COLORS = ['#46543a', '#5c7d43', '#7cb257', '#96d377', '#8ac168', '#d8c78e', '#3e6f9e', '#a89f8d'];
    const redrawCourseMap = () => {
      const course = state.course;
      const c2 = mapCanvas.getContext('2d');
      const W = 600, H = 400, M = 24, TOP = 48;
      c2.fillStyle = '#efe7d2'; c2.fillRect(0, 0, W, H);          // parchment mount
      c2.fillStyle = '#1f4a2e'; c2.fillRect(0, 0, W, TOP);        // title band
      c2.fillStyle = '#efe7d2'; c2.textBaseline = 'middle';
      c2.font = 'bold 23px Georgia, serif'; c2.fillText('PINEHOLLOW GOLF CLUB', 20, TOP / 2 - 1);
      c2.font = 'italic 13px Georgia, serif'; c2.textAlign = 'right'; c2.fillText('COURSE MAP', W - 20, TOP / 2);
      c2.textAlign = 'left';
      const x0 = M, y0 = TOP + 12, iw = W - M * 2, ih = H - y0 - M;
      const sx = iw / course.w, sy = ih / course.h;
      for (let y = 0; y < course.h; y++) {
        for (let x = 0; x < course.w; x++) {
          c2.fillStyle = MAP_COLORS[course.zones[y * course.w + x]] || '#46543a';
          c2.fillRect(x0 + x * sx, y0 + y * sy, sx + 0.6, sy + 0.6);
        }
      }
      c2.font = 'bold 12px Arial';
      state.course.holes.forEach((h, i) => {
        if (!h.pin) return;
        const px = x0 + h.pin.x * sx, py = y0 + h.pin.y * sy;
        c2.fillStyle = '#d84b3a'; c2.beginPath(); c2.arc(px, py, 4.5, 0, 7); c2.fill();
        c2.fillStyle = '#efe7d2'; c2.strokeStyle = '#22331e'; c2.lineWidth = 2.5;
        c2.strokeText(String(i + 1), px + 6, py); c2.fillText(String(i + 1), px + 6, py);
      });
      c2.strokeStyle = '#8a7a52'; c2.lineWidth = 3; c2.strokeRect(x0 - 5, y0 - 5, iw + 10, ih + 10);
      mapTex.needsUpdate = true;
    };
    redrawCourseMap();
    const mapWp = L2W(OFFICE.map.x, OFFICE.map.z - 0.5);
    addProp({
      x: mapWp.x, z: mapWp.z, r: 2.2,
      label: () => 'Course wall map — [E] step back to the overview camera',
      action: () => { if (hooks.toggleOverview) hooks.toggleOverview(); },
    });

    // calendar on the office's south wall
    const calCv = document.createElement('canvas');
    calCv.width = 96; calCv.height = 112;
    const cc = calCv.getContext('2d');
    cc.fillStyle = '#f2eee0'; cc.fillRect(0, 0, 96, 112);
    cc.fillStyle = '#1f8a34'; cc.fillRect(0, 0, 96, 24);
    cc.fillStyle = '#2b2b30';
    for (let r = 0; r < 5; r++) for (let col = 0; col < 7; col++) cc.fillRect(6 + col * 13, 32 + r * 15, 9, 10);
    const calTex = new THREE.CanvasTexture(calCv);
    calTex.colorSpace = THREE.SRGBColorSpace;
    const cal = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.82), new THREE.MeshStandardMaterial({ map: calTex, roughness: 0.9 }));
    cal.position.set(OFFICE.calendar.x, 1.8, INTERIOR.d / 2 - 0.05);
    cal.rotation.y = Math.PI;
    interior.add(cal);

    // THE LAPTOP — a real ~15" machine that starts CLOSED on the desk. E parks
    // you at the chair, the lid swings open around its rear hinge, the power
    // light comes on, a short boot plays on the physical screen — and then the
    // Fairway Office interface is projected ONTO that screen (main.js aligns
    // the DOM to the projected corners; no detached popup).
    // Every dimension comes from src/core/laptopRig.js and nothing is invented here, so the
    // orientation tests in laptop-rig.test.js are testing THIS machine and not a paper one.
    // The old machine was 21.6 inches across the deck with a 23.8-inch display — a television.
    const LID_OPEN = LAPTOP.lidOpen;
    const laptop = new THREE.Group();
    const alu = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.35, metalness: 0.75 });
    const aluDark = new THREE.MeshStandardMaterial({ color: 0x62676d, roughness: 0.4, metalness: 0.7 });
    const deck = new THREE.Mesh(roundedBox(LAPTOP.deck.w, LAPTOP.deck.t, LAPTOP.deck.d, 0.005), alu);
    deck.position.y = LAPTOP.deck.t / 2;
    deck.castShadow = true;
    laptop.add(deck);
    // keyboard: a canvas keycap grid inset into the deck. It sits BEYOND the trackpad and
    // NEARER than the display — the order a real laptop has, and the one the brief asks for.
    const kbCv = document.createElement('canvas');
    kbCv.width = 280; kbCv.height = 104;
    const kc = kbCv.getContext('2d');
    kc.fillStyle = '#4a4f55'; kc.fillRect(0, 0, 280, 104);
    kc.fillStyle = '#1d2024';
    const rowKeys = [14, 14, 13, 12, 9];
    for (let r = 0; r < 5; r++) {
      const n = rowKeys[r];
      const kw = 280 / n - 4;
      for (let c = 0; c < n; c++) kc.fillRect(3 + c * (280 / n), 4 + r * 20, kw, 16);
    }
    kc.fillStyle = '#1d2024';
    kc.fillRect(84, 84, 112, 16); // spacebar
    const kbTex = new THREE.CanvasTexture(kbCv);
    kbTex.colorSpace = THREE.SRGBColorSpace;
    const kb = new THREE.Mesh(
      new THREE.PlaneGeometry(LAPTOP.keyboard.w, LAPTOP.keyboard.d),
      new THREE.MeshStandardMaterial({ map: kbTex, roughness: 0.8 }),
    );
    kb.rotation.x = -Math.PI / 2;
    kb.position.set(0, LAPTOP.deck.t + 0.0012, LAPTOP.keyboard.z);
    laptop.add(kb);
    const trackpad = new THREE.Mesh(
      new THREE.PlaneGeometry(LAPTOP.trackpad.w, LAPTOP.trackpad.d),
      new THREE.MeshStandardMaterial({ color: 0x83898f, roughness: 0.3, metalness: 0.45 }),
    );
    trackpad.rotation.x = -Math.PI / 2;
    trackpad.position.set(0, LAPTOP.deck.t + 0.0014, LAPTOP.trackpad.z); // the palm rest, nearest the seat
    laptop.add(trackpad);
    // the small honest details: four rubber feet under the deck and a charge port on the
    // left flank, rear — the things that make a slab read as a machine somebody plugs in
    const rubber = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.95 });
    const footGeo = new THREE.CylinderGeometry(0.006, 0.007, 0.0035, 10);
    for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const foot = new THREE.Mesh(footGeo, rubber);
      foot.position.set(fx * (LAPTOP.deck.w / 2 - 0.022), 0.0002, fz * (LAPTOP.deck.d / 2 - 0.022));
      laptop.add(foot);
    }
    const chargePort = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.006, 0.016), rubber);
    chargePort.position.set(-LAPTOP.deck.w / 2 + 0.0008, LAPTOP.deck.t * 0.55, LAPTOP.hingeZ - 0.045);
    laptop.add(chargePort);

    // lid: hinged on the FAR edge (local +z), so it opens AWAY from the seated player and the
    // display leans back toward them. angle 0 = CLOSED, flat over the deck.
    const lidHinge = new THREE.Group();
    lidHinge.position.set(0, LAPTOP.hingeY, LAPTOP.hingeZ);
    const lid = new THREE.Mesh(roundedBox(LAPTOP.lid.w, LAPTOP.lid.t, LAPTOP.lid.d, 0.004), aluDark);
    lid.position.set(0, LAPTOP.lid.t / 2, -LAPTOP.lid.d / 2);
    lid.castShadow = true;
    lidHinge.add(lid);
    // THE BEZEL. There wasn't one: the glass was the whole underside of the lid, edge to edge,
    // which is why the interface always looked like a panel stuck to a slab rather than a screen
    // set into a machine. A black surround, and the display inset into it.
    const bezel = new THREE.Mesh(
      new THREE.PlaneGeometry(LAPTOP.lid.w - 0.004, LAPTOP.lid.d - 0.004),
      new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.55 }),
    );
    bezel.rotation.set(Math.PI / 2, 0, Math.PI);
    bezel.position.set(0, -0.0004, -LAPTOP.lid.d / 2);
    lidHinge.add(bezel);

    const screenCv = document.createElement('canvas');
    screenCv.width = 512; screenCv.height = 320; // 16:10, same as the interface
    const screenTex = new THREE.CanvasTexture(screenCv);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    // The glass faces DOWN when closed (it is the underside of the lid). The in-plane π turn
    // makes the painted image read upright and unmirrored to the seated player: plane-right
    // becomes local -x (the player's right) and plane-up becomes local -z (away from the
    // barrel, which is UP once the lid stands). laptopRig's screenCornersLocal assumes exactly
    // this — the two must not drift apart, or the DOM lands on the glass upside down.
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(LAPTOP.screen.w, LAPTOP.screen.h),
      new THREE.MeshStandardMaterial({ map: screenTex, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 0.62, roughness: 0.22 }),
    );
    screen.rotation.set(Math.PI / 2, 0, Math.PI);
    screen.position.set(0, -0.0006, -LAPTOP.lid.d / 2);
    lidHinge.add(screen);
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.005, 6, 4),
      new THREE.MeshStandardMaterial({ color: 0x223528, emissive: 0x35d06a, emissiveIntensity: 0.0 }),
    );
    led.position.set(LAPTOP.led.x, LAPTOP.deck.t, LAPTOP.led.z); // front lip, player side
    laptop.add(led, lidHinge);
    // 0.752 = the Sheet-04 kit desk's top (0.75) + clearance. The whole sit
    // rig (seat pose, screen corners) derives from the laptop's live world
    // matrix, so lowering the laptop reseats everything with it.
    laptop.position.set(OFFICE.laptop.x - 0.10, 0.752, OFFICE.laptop.z);
    laptop.rotation.y = OFFICE.laptop.ry;
    interior.add(laptop);

    // SCREEN STATE: 'off' → 'boot' → 'live' (the DOM is on the glass) | 'desk' (nobody sitting)
    //
    // This canvas used to paint a full DESKTOP — a green wallpaper with Supplier / Pro Shop /
    // Tee Sheet tiles — and it kept painting it while the real interface was projected on top.
    // Two interfaces, one screen. You could read the canvas menu THROUGH the gaps around the
    // misaligned DOM, and the whole thing read as a popup floating over a wallpaper, which is
    // exactly what the brief rejected. There is now no second menu anywhere:
    //
    //   'live' — a flat sheet of the interface's own paper colour. The DOM covers it exactly, so
    //            even a sub-pixel seam at the bezel shows cream, never a competing screen.
    //   'desk' — what you see walking PAST the open laptop: a lock screen. Crest, club, clock.
    //            Information, not navigation. There is nothing on it to click.
    let screenMode = 'off';
    let bootT0 = 0;
    const clock12 = () => {
      const mins = Math.floor(((state.clock.minutes % 1440) + 1440) % 1440);
      const hh = Math.floor(mins / 60);
      return `${((hh + 11) % 12) + 1}:${String(mins % 60).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`;
    };
    const pineMark = (c2, cx, cy, s, fill) => {
      c2.fillStyle = fill;
      for (let t = 0; t < 3; t++) {
        const w = s * (1 - t * 0.22);
        const yTop = cy - s * 0.6 + t * s * 0.34;
        c2.beginPath();
        c2.moveTo(cx, yTop);
        c2.lineTo(cx - w / 2, yTop + s * 0.44);
        c2.lineTo(cx + w / 2, yTop + s * 0.44);
        c2.closePath();
        c2.fill();
      }
      c2.fillRect(cx - s * 0.06, cy + s * 0.5, s * 0.12, s * 0.2);
    };
    function paintScreen(mode) {
      if (mode) screenMode = mode;
      const c2 = screenCv.getContext('2d');
      if (screenMode === 'off') {
        const g = c2.createLinearGradient(0, 0, 512, 320);
        g.addColorStop(0, '#14171b');
        g.addColorStop(0.5, '#1c2026');
        g.addColorStop(1, '#14171b');
        c2.fillStyle = g;
        c2.fillRect(0, 0, 512, 320);
        screenTex.needsUpdate = true;
        return;
      }
      if (screenMode === 'boot') {
        const p = Math.min(1, (performance.now() - bootT0) / 850);
        c2.fillStyle = '#0a160e';
        c2.fillRect(0, 0, 512, 320);
        pineMark(c2, 256, 120, 48, '#2e5a35');
        c2.fillStyle = '#cfa860';
        c2.font = 'bold 21px Georgia, serif';
        c2.textAlign = 'center';
        c2.fillText('GOLF SIMULATOR', 256, 208);
        c2.strokeStyle = '#26422e';
        c2.strokeRect(176, 232, 160, 8);
        c2.fillStyle = '#cfa860';
        c2.fillRect(178, 234, 156 * p, 4);
        screenTex.needsUpdate = true;
        return;
      }
      if (screenMode === 'live') {
        // the interface itself is a DOM welded to this rectangle. Underneath it, the same deep
        // pine the interface is painted on — a bezel seam shows glass, never a second screen.
        c2.fillStyle = '#0d1b12';
        c2.fillRect(0, 0, 512, 320);
        screenTex.needsUpdate = true;
        return;
      }
      // 'desk' — the lock screen. Nothing here is a menu.
      const grad = c2.createLinearGradient(0, 0, 0, 320);
      grad.addColorStop(0, '#1d3324');
      grad.addColorStop(1, '#0f1a14');
      c2.fillStyle = grad;
      c2.fillRect(0, 0, 512, 320);
      pineMark(c2, 256, 108, 44, '#2f5c39');
      c2.textAlign = 'center';
      c2.fillStyle = '#e8efe4';
      c2.font = 'bold 22px Georgia, serif';
      c2.fillText(state.clubName || 'The Club', 256, 196);
      c2.fillStyle = '#8fae95';
      c2.font = '15px system-ui, sans-serif';
      c2.fillText(clock12(), 256, 224);
      c2.fillStyle = '#5d7a64';
      c2.font = '12px system-ui, sans-serif';
      c2.fillText('GOLF SIMULATOR — press E to sign in', 256, 286);
      screenTex.needsUpdate = true;
    }
    paintScreen('off');
    office.paintScreen = paintScreen;
    office.screenMode = () => screenMode;

    // lid animation driven from the clubhouse update loop
    const lidState = { angle: 0, target: 0 };
    office.updateLid = (dt) => {
      const diff = lidState.target - lidState.angle;
      if (Math.abs(diff) > 0.001) {
        lidState.angle += diff * Math.min(1, dt * 6.5);
        lidHinge.rotation.x = lidState.angle;
      }
      if (screenMode === 'boot') paintScreen(); // animate the progress bar
    };
    office.setLid = (open) => {
      lidState.target = open ? LID_OPEN : 0;
      led.material.emissiveIntensity = open ? 1.4 : 0.0;
    };
    office.startBoot = () => {
      bootT0 = performance.now();
      paintScreen('boot');
    };
    // World-space corners of the DISPLAY, in the order the seated player reads them:
    // [top-left, top-right, bottom-right, bottom-left].
    //
    // main.js used to project all four and SORT them by y to guess which pair was the top. That
    // guess is only ever as good as the camera angle, and it is unnecessary: the lid's own frame
    // knows the answer exactly. laptopRig hands it over; the guess is deleted.
    //
    // Note this reads the LIVE lid angle, so the corners are correct mid-swing too — which is
    // what lets the interface ride the lid open instead of popping in once it has stopped.
    office.screenCorners = () => {
      laptop.updateWorldMatrix(true, false);
      return screenCornersLocal(lidState.angle)
        .map((c) => laptop.localToWorld(new THREE.Vector3(c.x, c.y, c.z)));
    };
    office.lidAngle = () => lidState.angle;
    office.lidOpenAngle = LID_OPEN;
    office.laptopObject = laptop;

    const compWp = L2W(OFFICE.laptop.x, OFFICE.laptop.z);
    office.computerProp = addProp({
      x: compWp.x, z: compWp.z, r: 2.3,
      label: () => 'Laptop — [E] open GOLF SIMULATOR',
      action: () => { if (hooks.openLaptop) hooks.openLaptop(); },
    });
    office.laptop = laptop;

    // Where the camera settles when you sit down. Derived from the OPEN lid, the live field of
    // view and the window shape, so the screen fills the view on any monitor — a hardcoded seat
    // is what left it at 9.7% of the viewport once before. The lid is still shut when the player
    // presses E, so this asks the rig where the glass WILL be rather than posing the mesh.
    office.seatPose = (fovDeg = 60, aspect = 16 / 9) => {
      laptop.updateWorldMatrix(true, false);
      const corners = screenCornersLocal(LID_OPEN)
        .map((c) => laptop.localToWorld(new THREE.Vector3(c.x, c.y, c.z)));
      const centre = new THREE.Vector3();
      for (const c of corners) centre.add(c);
      centre.multiplyScalar(0.25);
      const n = screenNormalLocal(LID_OPEN);
      const out = new THREE.Vector3(n.x, n.y, n.z).transformDirection(laptop.matrixWorld).normalize();

      const dist = fitDistance({
        screenW: LAPTOP.screen.w, screenH: LAPTOP.screen.h, fovDeg, aspect, fracH: 0.80, fracW: 0.90,
      });
      // Sit a touch high and aim a touch low. Both together push the screen up in frame and
      // leave the bezel and a strip of keyboard showing underneath it — which is the difference
      // between sitting at a laptop and having a menu shoved in your face.
      const eye = centre.clone().addScaledVector(out, dist);
      eye.y += LAPTOP.screen.h * 0.16;
      const aim = centre.clone();
      aim.y -= LAPTOP.screen.h * 0.10;

      // look back at the screen: forward = (-sin y cos p, sin p, -cos y cos p)
      const f = aim.clone().sub(eye).normalize();
      return {
        x: eye.x, y: eye.y, z: eye.z,
        yaw: Math.atan2(-f.x, -f.z),
        pitch: Math.asin(Math.max(-1, Math.min(1, f.y))),
      };
    };

    // The orientation gizmos that lived here (forward vector, keyboard direction, screen
    // normal, hinge axis, interaction point, camera position and target) did their job and
    // have been removed, as the brief asks. They proved the machine faces the chair ONCE.
    // tests/laptop-rig.test.js proves it on every run — which is the version worth keeping.
    // Evidence: qa/laptop/debug/.
  }

  // lounge dressing: trophy shelf + course photo (sofa arrives as decor)
  {
    const shelf = new THREE.Group();
    for (const y of [1.5, 1.05]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.3), woodMat);
      board.position.set(0, y, 0);
      shelf.add(board);
    }
    // trophies — were plain gold cylinders; a real cup has a bowl, a stem, a base
    // and two handles, which is what the audit asked for (ref 8).
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xd8b23a, metalness: 0.85, roughness: 0.26 });
    const plinthMat = new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.6 });
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.066, 0.036, 14), plinthMat);
      base.position.y = 0.018;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.055, 10), goldMat);
      stem.position.y = 0.064;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.02, 0.085, 14, 1, true), goldMat);
      bowl.position.y = 0.134;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 6, 16), goldMat);
      rim.rotation.x = Math.PI / 2; rim.position.y = 0.176;
      t.add(base, stem, bowl, rim);
      for (const sgn of [-1, 1]) {
        const h = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.005, 6, 12, Math.PI), goldMat);
        h.position.set(sgn * 0.05, 0.146, 0);
        h.rotation.set(Math.PI / 2, 0, sgn > 0 ? -Math.PI / 2 : Math.PI / 2);
        t.add(h);
      }
      t.castShadow = true;
      t.scale.setScalar(0.85 + (i % 2) * 0.22);
      t.position.set(-0.5 + i * 0.5, 1.55, 0);
      shelf.add(t);
    }
    const mags = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.3), new THREE.MeshStandardMaterial({ color: 0x3b6fb3, roughness: 0.8 }));
    mags.position.set(0.4, 1.09, 0);
    shelf.add(mags);
    shelf.position.set(LOUNGE.trophy.x, 0, LOUNGE.trophy.z);
    shelf.rotation.y = LOUNGE.trophy.ry;
    interior.add(shelf);

    // A framed photograph of the home course — was a flat two-stop gradient with a
    // 2px flag. A painterly landscape now: warm sky, clouds, a tree line, a fairway
    // sweeping in mown stripes to a green with the pin and a bunker beside it.
    const photoCv = document.createElement('canvas');
    photoCv.width = 480; photoCv.height = 304;
    const pc = photoCv.getContext('2d');
    const sky = pc.createLinearGradient(0, 0, 0, 180);
    sky.addColorStop(0, '#7fb4e6'); sky.addColorStop(0.7, '#c3e2f2'); sky.addColorStop(1, '#e9f2ec');
    pc.fillStyle = sky; pc.fillRect(0, 0, 480, 180);
    pc.fillStyle = 'rgba(255,255,255,0.75)';
    for (const [cx, cy, r] of [[92, 46, 24], [122, 52, 32], [154, 46, 20], [332, 34, 26], [368, 42, 36], [402, 34, 22]]) {
      pc.beginPath(); pc.ellipse(cx, cy, r, r * 0.58, 0, 0, 7); pc.fill();
    }
    pc.fillStyle = '#3f5f3a';   // rolling tree line
    pc.beginPath(); pc.moveTo(0, 180);
    for (let x = 0; x <= 480; x += 20) pc.lineTo(x, 156 + Math.sin(x * 0.045) * 13 - (x % 60 < 20 ? 8 : 0));
    pc.lineTo(480, 180); pc.closePath(); pc.fill();
    const turf = pc.createLinearGradient(0, 176, 0, 304);
    turf.addColorStop(0, '#6fa049'); turf.addColorStop(1, '#8cbf5f');
    pc.fillStyle = turf; pc.fillRect(0, 174, 480, 130);
    pc.fillStyle = '#5c8340';   // rough framing the fairway
    pc.beginPath(); pc.moveTo(0, 178); pc.lineTo(150, 178); pc.lineTo(0, 304); pc.closePath(); pc.fill();
    pc.beginPath(); pc.moveTo(480, 178); pc.lineTo(336, 178); pc.lineTo(480, 304); pc.closePath(); pc.fill();
    pc.strokeStyle = 'rgba(255,255,255,0.07)'; pc.lineWidth = 7;   // mowing stripes
    for (let i = -3; i < 8; i++) { pc.beginPath(); pc.moveTo(240 + i * 12, 178); pc.lineTo(240 + i * 64, 304); pc.stroke(); }
    pc.fillStyle = '#e6d5a2'; pc.beginPath(); pc.ellipse(300, 214, 32, 11, 0, 0, 7); pc.fill();   // bunker
    pc.fillStyle = '#93cc66'; pc.beginPath(); pc.ellipse(232, 216, 46, 16, 0, 0, 7); pc.fill();    // green
    pc.strokeStyle = '#39392f'; pc.lineWidth = 2; pc.beginPath(); pc.moveTo(232, 214); pc.lineTo(232, 174); pc.stroke();
    pc.fillStyle = '#d84b3a'; pc.beginPath(); pc.moveTo(232, 174); pc.lineTo(254, 181); pc.lineTo(232, 189); pc.closePath(); pc.fill();
    const vg = pc.createRadialGradient(240, 150, 70, 240, 150, 300);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(24,20,8,0.30)');
    pc.fillStyle = vg; pc.fillRect(0, 0, 480, 304);
    const photoTex = new THREE.CanvasTexture(photoCv);
    photoTex.colorSpace = THREE.SRGBColorSpace;
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.95), new THREE.MeshStandardMaterial({ map: photoTex, roughness: 0.85 }));
    photo.position.set(LOUNGE.photo.x, 1.95, -INTERIOR.d / 2 + 0.05);
    interior.add(photo);
    const photoFrame = new THREE.Mesh(new THREE.PlaneGeometry(1.66, 1.1), new THREE.MeshStandardMaterial({ color: 0x3d3122, roughness: 0.8 }));
    photoFrame.position.set(LOUNGE.photo.x, 1.95, -INTERIOR.d / 2 + 0.04);
    interior.add(photoFrame);
  }

  // stockroom delivery dressing: authored equipment is installed by the shared
  // delivery-equipment runtime below; this block owns recycling and receiving.
  {
    const recyclingStation = new THREE.Group();
    recyclingStation.name = 'DeliveryRecyclingStation';
    recyclingStation.position.set(STOCKROOM.bin.x, 0, STOCKROOM.bin.z);
    recyclingStation.rotation.y = -Math.PI * 0.5;
    interior.add(recyclingStation);
    const fallbackBin = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.82, 0.58),
      new THREE.MeshStandardMaterial({ color: 0x31543b, roughness: 0.82 }),
    );
    fallbackBin.name = 'DeliveryRecyclingStationFallback';
    fallbackBin.position.y = 0.41;
    recyclingStation.add(fallbackBin);
    merch.onReady(() => {
      if (!recyclingStation.parent) return;
      const authored = merch.instantiate('delivery_recycling_station');
      if (!authored) return;
      fallbackBin.removeFromParent();
      fallbackBin.geometry.dispose();
      fallbackBin.material.dispose();
      authored.name = 'DeliveryRecyclingStationAuthored';
      recyclingStation.add(authored);
    });

    // receiving pad — deliveries will land here (gravel patch + posts)
    const padWp = L2W(STOCKROOM.padOutside.x, STOCKROOM.padOutside.z);
    const apron = DELIVERY_PALLET_STAGING.receivingApron;
    const terrainSamples = [];
    for (const xFactor of [-1, -0.5, 0, 0.5, 1]) {
      for (const zFactor of [-1, -0.5, 0, 0.5, 1]) {
        const sample = L2W(
          STOCKROOM.padOutside.x + xFactor * apron.length / 2,
          STOCKROOM.padOutside.z + zFactor * apron.width / 2,
        );
        const height = heightAt(sample.x, sample.z);
        if (Number.isFinite(height)) terrainSamples.push(height);
      }
    }
    deliveryPadSurfaceY = Math.max(...terrainSamples) + 0.018;
    const pad = new THREE.Mesh(
      roundedBox(apron.length, apron.depth, apron.width, 0.025),
      new THREE.MeshStandardMaterial({ color: 0x73736b, roughness: 0.96 }),
    );
    pad.name = 'DeliveryReceivingSlab';
    pad.position.set(padWp.x, deliveryPadSurfaceY - apron.depth / 2, padWp.z);
    pad.receiveShadow = true;
    scene.add(pad);

    // Paint the five physical receiving bays from the same offsets that own
    // their pallet anchors. One top sheet is cheaper and harder to desynchronise
    // than a collection of loose line meshes.
    const apronCanvas = document.createElement('canvas');
    apronCanvas.width = 1024;
    apronCanvas.height = 640;
    const apronInk = apronCanvas.getContext('2d');
    apronInk.fillStyle = '#777970';
    apronInk.fillRect(0, 0, apronCanvas.width, apronCanvas.height);
    apronInk.strokeStyle = '#203f2b';
    apronInk.lineWidth = 10;
    apronInk.strokeRect(12, 12, apronCanvas.width - 24, apronCanvas.height - 24);
    apronInk.strokeStyle = '#d0b061';
    apronInk.lineWidth = 9;
    apronInk.setLineDash([24, 14]);
    const apronPxX = apronCanvas.width / apron.length;
    const apronPxZ = apronCanvas.height / apron.width;
    for (const offset of DELIVERY_PALLET_STAGING.offsets) {
      const bayW = (DELIVERY_PALLET_STAGING.length + 0.10) * apronPxX;
      const bayH = (DELIVERY_PALLET_STAGING.width + 0.10) * apronPxZ;
      const bayX = (offset.x + apron.length / 2) * apronPxX - bayW / 2;
      const bayY = (apron.width / 2 - offset.z) * apronPxZ - bayH / 2;
      apronInk.strokeRect(bayX, bayY, bayW, bayH);
    }
    apronInk.setLineDash([]);
    const apronTexture = new THREE.CanvasTexture(apronCanvas);
    apronTexture.colorSpace = THREE.SRGBColorSpace;
    const apronMarkings = new THREE.Mesh(
      new THREE.PlaneGeometry(apron.length - 0.05, apron.width - 0.05),
      new THREE.MeshStandardMaterial({ map: apronTexture, roughness: 0.94 }),
    );
    apronMarkings.name = 'DeliveryReceivingBayMarkings';
    apronMarkings.rotation.x = -Math.PI / 2;
    apronMarkings.position.set(padWp.x, deliveryPadSurfaceY + 0.002, padWp.z);
    apronMarkings.receiveShadow = true;
    scene.add(apronMarkings);

    // Ref 41 parks beside receiving, not on the golf turf. The service bay is
    // derived from the authored van envelope and its shared runtime layout, so
    // it remains aligned if the presentation route is tuned later.
    const vanLayout = DELIVERY_EQUIPMENT_DEFAULT_LAYOUT.delivery_van;
    const vanBayWidth = 2.72;
    const vanBayLength = 6.35;
    const vanBayDepth = 0.065;
    const vanBayWorld = L2W(vanLayout.x, vanLayout.z);
    const vanBayTerrain = [];
    for (const xFactor of [-1, -0.5, 0, 0.5, 1]) {
      for (const zFactor of [-1, -0.66, -0.33, 0, 0.33, 0.66, 1]) {
        const sample = L2W(
          vanLayout.x + xFactor * vanBayWidth / 2,
          vanLayout.z + zFactor * vanBayLength / 2,
        );
        const height = heightAt(sample.x, sample.z);
        if (Number.isFinite(height)) vanBayTerrain.push(height);
      }
    }
    // The course path is rendered slightly proud of the terrain. Lift the
    // service slab enough to remain one continuous, readable pad where the two
    // surfaces cross, while keeping the resulting curb below a normal step.
    deliveryVanBaySurfaceY = Math.max(...vanBayTerrain) + 0.040;
    deliveryVanBayBounds = Object.freeze({
      minX: vanBayWorld.x - vanBayWidth / 2,
      maxX: vanBayWorld.x + vanBayWidth / 2,
      minZ: vanBayWorld.z - vanBayLength / 2,
      maxZ: vanBayWorld.z + vanBayLength / 2,
      centerX: vanBayWorld.x,
      centerZ: vanBayWorld.z,
      blend: 0.42,
    });
    const vanBay = new THREE.Mesh(
      roundedBox(vanBayWidth, vanBayDepth, vanBayLength, 0.035),
      new THREE.MeshStandardMaterial({ color: 0x50534d, roughness: 0.97 }),
    );
    vanBay.name = 'DeliveryVanServiceBay';
    vanBay.userData.surfaceY = deliveryVanBaySurfaceY;
    vanBay.userData.localCenter = { x: vanLayout.x, z: vanLayout.z };
    vanBay.userData.dimensions = { width: vanBayWidth, length: vanBayLength, depth: vanBayDepth };
    vanBay.position.set(
      vanBayWorld.x,
      deliveryVanBaySurfaceY - vanBayDepth / 2,
      vanBayWorld.z,
    );
    vanBay.receiveShadow = true;
    scene.add(vanBay);

    // Ref 41 now follows a visible service route for its entire authored
    // approach and departure instead of materialising from raw turf. Each
    // direction is built as two terrain-conforming half-lanes: the four named
    // meshes remain cheap and auditable, but meet at the centreline to read as
    // one deliberate service drive instead of isolated debug wheel strips.
    const makeServiceTrack = (name, localX, localZStart, localZEnd) => {
      const segments = 24;
      const width = vanBayWidth / 2;
      const positions = [];
      const uvs = [];
      const indices = [];
      for (let i = 0; i <= segments; i += 1) {
        const t = i / segments;
        const localZ = THREE.MathUtils.lerp(localZStart, localZEnd, t);
        for (const side of [-0.5, 0.5]) {
          const world = L2W(localX + side * width, localZ);
          const terrainY = heightAt(world.x, world.z);
          positions.push(world.x, (Number.isFinite(terrainY) ? terrainY : 0) + 0.022, world.z);
          uvs.push(side + 0.5, t * 8);
        }
        if (i < segments) {
          const a = i * 2;
          indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0x50534d, roughness: 0.98 }),
      );
      mesh.name = name;
      mesh.receiveShadow = true;
      return mesh;
    };
    const trackNearBayZ = vanBayLength / 2 - 0.18;
    const routeApproachZ = vanLayout.z + Math.abs(DELIVERY_VAN_ROUTE.approachOffset.z) + 0.35;
    const routeDepartureZ = vanLayout.z - Math.abs(DELIVERY_VAN_ROUTE.departureOffset.z) - 0.35;
    const serviceTracks = new THREE.Group();
    serviceTracks.name = 'DeliveryVanServiceDrive';
    for (const [side, localX] of [
      ['Left', vanLayout.x - vanBayWidth / 4],
      ['Right', vanLayout.x + vanBayWidth / 4],
    ]) {
      serviceTracks.add(
        makeServiceTrack(
          `DeliveryVanApproachTrack${side}`,
          localX,
          vanLayout.z + trackNearBayZ,
          routeApproachZ,
        ),
        makeServiceTrack(
          `DeliveryVanDepartureTrack${side}`,
          localX,
          vanLayout.z - trackNearBayZ,
          routeDepartureZ,
        ),
      );
    }
    scene.add(serviceTracks);

    const bayCanvas = document.createElement('canvas');
    bayCanvas.width = 512;
    bayCanvas.height = 1024;
    const bayInk = bayCanvas.getContext('2d');
    bayInk.fillStyle = '#50534d';
    bayInk.fillRect(0, 0, bayCanvas.width, bayCanvas.height);
    bayInk.strokeStyle = '#b89a4e';
    bayInk.lineWidth = 9;
    bayInk.setLineDash([34, 20]);
    for (const x of [55, bayCanvas.width - 55]) {
      bayInk.beginPath();
      bayInk.moveTo(x, 46);
      bayInk.lineTo(x, bayCanvas.height - 46);
      bayInk.stroke();
    }
    bayInk.setLineDash([]);
    bayInk.strokeStyle = '#d7cfb2';
    bayInk.lineWidth = 7;
    bayInk.strokeRect(18, 18, bayCanvas.width - 36, bayCanvas.height - 36);
    bayInk.fillStyle = '#d7cfb2';
    bayInk.font = '700 46px sans-serif';
    bayInk.textAlign = 'center';
    bayInk.textBaseline = 'middle';
    bayInk.fillText('DELIVERY', bayCanvas.width / 2, bayCanvas.height * 0.43);
    bayInk.font = '600 30px sans-serif';
    bayInk.fillText('RECEIVING ONLY', bayCanvas.width / 2, bayCanvas.height * 0.49);
    bayInk.fillStyle = '#b89a4e';
    bayInk.beginPath();
    bayInk.moveTo(bayCanvas.width / 2, bayCanvas.height * 0.60);
    bayInk.lineTo(bayCanvas.width / 2 - 46, bayCanvas.height * 0.67);
    bayInk.lineTo(bayCanvas.width / 2 + 46, bayCanvas.height * 0.67);
    bayInk.closePath();
    bayInk.fill();
    const bayTexture = new THREE.CanvasTexture(bayCanvas);
    bayTexture.colorSpace = THREE.SRGBColorSpace;
    bayTexture.anisotropy = 4;
    const bayMarkings = new THREE.Mesh(
      new THREE.PlaneGeometry(vanBayWidth - 0.05, vanBayLength - 0.05),
      new THREE.MeshStandardMaterial({ map: bayTexture, roughness: 0.95 }),
    );
    bayMarkings.name = 'DeliveryVanServiceBayMarkings';
    bayMarkings.rotation.x = -Math.PI / 2;
    bayMarkings.position.set(vanBayWorld.x, deliveryVanBaySurfaceY + 0.002, vanBayWorld.z);
    bayMarkings.receiveShadow = true;
    scene.add(bayMarkings);

    const transferStrip = new THREE.Mesh(
      roundedBox(0.07, 0.018, apron.width - 0.32, 0.008),
      new THREE.MeshStandardMaterial({ color: 0xb89a4e, roughness: 0.75, metalness: 0.12 }),
    );
    transferStrip.name = 'DeliveryApronVanBayTransferStrip';
    transferStrip.position.set(
      (padWp.x + apron.length / 2 + deliveryVanBayBounds.minX) / 2,
      Math.max(deliveryPadSurfaceY, deliveryVanBaySurfaceY) + 0.007,
      padWp.z,
    );
    transferStrip.receiveShadow = true;
    scene.add(transferStrip);

    // Join the slab to the service threshold. The previous grass strip made
    // the loading area read as a detached display instead of a usable route.
    const connectorNearZ = STOCKROOM.padOutside.z - apron.width / 2;
    const connectorFarZ = DOOR_BACK.z;
    const connectorCentre = L2W(
      INTERIOR.w / 2 + 0.45,
      (connectorNearZ + connectorFarZ) / 2,
    );
    const connectorDepth = apron.depth * 0.78;
    const connectorRun = connectorNearZ - connectorFarZ;
    const connectorRise = deliveryPadSurfaceY - floorY;
    const connectorLength = Math.hypot(connectorRun, connectorRise);
    // roundedBox's long axis is local +Z. Rotating about X aligns that axis
    // with the two top-surface endpoints without extending beneath either
    // surface, so the apron edge cannot z-fight a coplanar overlap strip.
    const connectorPitch = Math.atan2(-connectorRise, connectorRun);
    const connector = new THREE.Mesh(
      roundedBox(
        0.92,
        connectorDepth,
        connectorLength,
        0.025,
      ),
      new THREE.MeshStandardMaterial({ color: 0x73736b, roughness: 0.96 }),
    );
    connector.name = 'DeliveryReceivingThresholdConnector';
    connector.rotation.x = connectorPitch;
    connector.position.set(
      connectorCentre.x,
      (deliveryPadSurfaceY + floorY) / 2
        - Math.cos(connectorPitch) * connectorDepth / 2,
      connectorCentre.z,
    );
    connector.userData.padSurfaceY = deliveryPadSurfaceY;
    connector.userData.floorSurfaceY = floorY;
    connector.userData.localNearZ = connectorNearZ;
    connector.userData.localFarZ = connectorFarZ;
    connector.receiveShadow = true;
    scene.add(connector);
    const drainage = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.012, apron.width - 0.30),
      new THREE.MeshStandardMaterial({ color: 0x353934, roughness: 0.82, metalness: 0.18 }),
    );
    drainage.name = 'DeliveryReceivingDrainageChannel';
    drainage.position.set(
      padWp.x + apron.length / 2 - 0.14,
      deliveryPadSurfaceY + 0.006,
      padWp.z,
    );
    drainage.receiveShadow = true;
    scene.add(drainage);
    ctx.extraMeshes = ctx.extraMeshes || [];
    ctx.extraMeshes.push(
      pad, apronMarkings, connector, drainage,
      vanBay, bayMarkings, transferStrip, serviceTracks,
    );

    // The interior plaque helps once the player is in the stockroom; this
    // exterior marker makes the service entrance legible from the van, road,
    // and pallet apron as one deliberate receiving zone.
    const receivingSign = new THREE.Group();
    receivingSign.name = 'DeliveryReceivingExteriorSign';
    receivingSign.position.set(halfW + 0.10, FLOOR_TOP + DOOR_BACK.h + 0.42, DOOR_BACK.z);
    group.add(receivingSign);
    const receivingBack = new THREE.Mesh(
      roundedBox(0.08, 0.68, 1.62, 0.025),
      mats.greenPaint,
    );
    receivingBack.name = 'DeliveryReceivingExteriorSignBack';
    receivingBack.castShadow = true;
    receivingSign.add(receivingBack);
    const receivingTexture = makeSignTexture(['RECEIVING', 'FAIRWAY SUPPLY'], {
      w: 512,
      h: 224,
      field: '#f1ecdc',
      ink: '#173f29',
      accent: '#b89a4e',
      sizes: [64, 35],
    });
    const receivingFace = new THREE.Mesh(
      new THREE.PlaneGeometry(1.48, 0.56),
      new THREE.MeshStandardMaterial({ map: receivingTexture, roughness: 0.82 }),
    );
    receivingFace.name = 'DeliveryReceivingExteriorSignFace';
    receivingFace.position.x = 0.041;
    receivingFace.rotation.y = Math.PI / 2;
    receivingSign.add(receivingFace);

    // Five exact ref-44 pallets bound the nine-box receiving capacity to two
    // cartons high. Four fixed controls share one baked visual; pallet index 2
    // stays as an authored hierarchy so Ref 45 can lift the real pallet rather
    // than animating its forks beneath a static duplicate.
    deliveryPalletStage = new THREE.Group();
    deliveryPalletStage.name = 'DeliveryPalletStage';
    deliveryPalletStage.userData.ready = false;
    scene.add(deliveryPalletStage);
    ctx.extraMeshes.push(deliveryPalletStage);
    merch.onReady(() => {
      if (!deliveryPalletStage?.parent || deliveryPalletStage.userData.ready) return;
      const visualSources = new THREE.Group();
      visualSources.name = 'DeliveryPalletBakeSources';
      let authoredCount = 0;
      let batchedCount = 0;
      for (const centre of deliveryPalletCentres()) {
        // Ref 44 owns a deliberately pale, matte shipping-oak palette. Keep its
        // authored materials instead of remapping M_NaturalOak/M_Walnut onto the
        // much darker clubhouse furniture kit.
        const pallet = merch.instantiateRaw(DELIVERY_PALLET_STAGING.model);
        if (!pallet) continue;
        const world = L2W(centre.x, centre.z);

        const anchor = new THREE.Group();
        anchor.name = `DeliveryPallet_${centre.palletIndex + 1}`;
        anchor.position.set(world.x, deliveryPadSurfaceY, world.z);
        anchor.rotation.y = centre.ry;
        anchor.userData.asset_id = DELIVERY_PALLET_STAGING.model;
        anchor.userData.reference_id = '44';
        anchor.userData.palletIndex = centre.palletIndex;
        anchor.userData.dimensions = [
          DELIVERY_PALLET_STAGING.length,
          DELIVERY_PALLET_STAGING.height,
          DELIVERY_PALLET_STAGING.width,
        ];
        deliveryPalletStage.add(anchor);

        if (centre.palletIndex === DELIVERY_PALLET_JACK_COUPLED_INDEX) {
          // Raw clones retain authoring helpers because the fixed pallets only
          // hide them during bake. Explicitly suppress those proxies on the one
          // articulated clone that remains in the live scene.
          pallet.traverse((object) => {
            if (object.isMesh && (
              object.userData?.helper
              || object.userData?.collision_proxy
              || /^(?:COL_|COLLISION_|VOLUME_)/i.test(String(object.name || ''))
            )) object.visible = false;
          });
          pallet.name = 'DeliveryPalletCoupledVisual';
          pallet.position.set(0, 0, 0);
          pallet.rotation.set(0, 0, 0);
          anchor.add(pallet);
          coupledDeliveryPalletAnchor = anchor;
          coupledDeliveryPalletAssetRoot = pallet.getObjectByName(DELIVERY_PALLET_STAGING.model)
            || pallet;
        } else {
          pallet.position.set(world.x, deliveryPadSurfaceY, world.z);
          pallet.rotation.y = centre.ry;
          visualSources.add(pallet);
          batchedCount += 1;
        }
        authoredCount += 1;
        const collider = colBoxAt(
          centre.x, centre.z,
          DELIVERY_PALLET_STAGING.length, DELIVERY_PALLET_STAGING.width,
        );
        collider.kind = 'delivery-pallet';
        collider.palletIndex = centre.palletIndex;
        collider.minY = deliveryPadSurfaceY;
        collider.maxY = deliveryPadSurfaceY + DELIVERY_PALLET_STAGING.height;
        addCol(collider);
        if (centre.palletIndex === DELIVERY_PALLET_JACK_COUPLED_INDEX) {
          coupledDeliveryPalletCollider = collider;
        }
      }
      if (authoredCount !== DELIVERY_PALLET_STAGING.count) return;
      const baked = merch.bake(visualSources, { visibleOnly: true });
      baked.name = 'DeliveryPalletBatchedVisuals';
      deliveryPalletStage.add(baked);
      deliveryPalletStage.userData.authoredPalletCount = authoredCount;
      deliveryPalletStage.userData.batchedPalletCount = batchedCount;
      deliveryPalletStage.userData.coupledPalletIndex = DELIVERY_PALLET_JACK_COUPLED_INDEX;
      deliveryPalletStage.userData.ready = true;
    });
  }

  // --- clutter piles ------------------------------------------------------------------------
  const cardboard = mats.kraft;
  const cardboardDark = new THREE.MeshStandardMaterial({ map: mats.kraft.map, color: 0xd8c3a4, roughness: 0.92 });
  const tapeMat = new THREE.MeshStandardMaterial({ color: 0x8a6f42, roughness: 0.75 });
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.95 });
  const shipLabelMat = new THREE.MeshStandardMaterial({
    map: makeProductLabel({ brand: 'FAIRWAY SUPPLY CO.', name: 'FRAGILE', band: '#57795c', glyph: 'bar', field: '#efe9d9' }),
    roughness: 0.85,
  });
  const clutterObjs = [];

  function tweenScale(obj, from, to, dur, onDone) {
    const t0 = performance.now();
    obj.scale.setScalar(from);
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / (dur * 1000));
      const e = 1 - Math.pow(1 - t, 3);
      obj.scale.setScalar(from + (to - from) * e);
      if (t < 1) requestAnimationFrame(step);
      else if (onDone) onDone();
    };
    requestAnimationFrame(step);
  }

  function buildClutterPile(idx, pile) {
    const g = new THREE.Group();
    // abandoned shipment: kraft cases with a shipping label, one burst open
    const big = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.5), [cardboard, cardboard, cardboard, cardboard, shipLabelMat, cardboard]);
    big.position.y = 0.25;
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.015, 0.12), tapeMat);
    tape.position.y = 0.505;
    const small = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.36, 0.42), cardboardDark);
    small.position.set(0.08, 0.68, -0.03);
    small.rotation.y = 0.45;
    // open flaps on the small case
    for (const [fx, fr] of [[-0.2, 0.9], [0.2, -0.8]]) {
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.4), cardboardDark);
      flap.position.set(0.08 + fx, 0.875, -0.03);
      flap.rotation.set(0, 0.45, fr);
      g.add(flap);
    }
    const flat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 0.44), cardboard);
    flat.position.set(-0.45, 0.05, 0.22);
    flat.rotation.y = -0.5;
    flat.rotation.z = 0.05;
    // A crumpled packing-paper wad. Subdivided and squashed unevenly (with a per-pile
    // rotation) so it reads as paper rather than a faceted white gem when it happens to
    // land in the register camera — the flat 20-face icosphere caught light like crystal.
    const paper = new THREE.Mesh(new THREE.IcosahedronGeometry(0.072, 1), paperMat);
    paper.position.set(0.42, 0.072, 0.3);
    paper.scale.set(1.18, 0.8, 0.98);
    paper.rotation.set(0.5, idx * 1.3 + 0.4, 0.7);
    paper.castShadow = true;
    // loose packing paper sheets around the pile
    for (let i = 0; i < 3; i++) {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.2), paperMat);
      sheet.rotation.set(-Math.PI / 2 + (idx % 3) * 0.04, (idx * 31 + i * 73) % 6, 0);
      sheet.position.set(Math.sin(idx * 5 + i * 2.4) * 0.65, 0.012 + i * 0.002, Math.cos(idx * 3 + i * 1.7) * 0.55);
      g.add(sheet);
    }
    for (const m of [big, small, flat]) m.castShadow = true;
    g.add(big, tape, small, flat, paper);
    g.position.set(pile.x, 0, pile.z);
    g.rotation.y = pile.ry;
    interior.add(g);

    const collider = addCol(colBoxAt(pile.x, pile.z, 0.9, 0.9));
    const wp = L2W(pile.x, pile.z);
    const prop = addProp({
      x: wp.x, z: wp.z, r: 1.9,
      label: () => 'Old clutter — [E] haul it out',
      action: () => {
        const res = clearClutter(state, idx);
        if (!res.ok) return;
        removeCol(collider);
        removeProp(prop);
        const co = clutterObjs.find((c) => c.group === g);
        if (co) clutterObjs.splice(clutterObjs.indexOf(co), 1);
        tweenScale(g, 1, 0.01, 0.2, () => interior.remove(g));
        repaintGrime();
        refreshCondition();
        if (hooks.sfx) hooks.sfx('thunk');
        if (hooks.toast) hooks.toast('Hauled a pile of junk out the back.');
      },
    });
    clutterObjs.push({ group: g, collider, prop });
  }

  // --- decor (placed pieces + green placement ghosts) -----------------------------------------
  const decorObjs = [];
  let popNextDecor = null;
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x45d052, transparent: true, opacity: 0.32, depthWrite: false });

  function makeRugMesh() {
    const cv = document.createElement('canvas');
    cv.width = 192; cv.height = 128;
    const c2 = cv.getContext('2d');
    c2.fillStyle = '#3f6d45';
    c2.fillRect(0, 0, 192, 128);
    c2.strokeStyle = '#dfd8c2';
    c2.lineWidth = 7;
    c2.strokeRect(10, 10, 172, 108);
    c2.fillStyle = '#dfd8c2';
    c2.beginPath();
    c2.moveTo(96, 30); c2.lineTo(120, 62); c2.lineTo(104, 62); c2.lineTo(124, 92);
    c2.lineTo(68, 92); c2.lineTo(88, 62); c2.lineTo(72, 62);
    c2.closePath(); c2.fill();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(3.0, 2.0),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.018;
    rug.receiveShadow = true;
    const g = new THREE.Group();
    g.add(rug);
    return { group: g, colliders: [] };
  }

  function makePlantMesh(spot) {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.18, 0.26, 10),
      new THREE.MeshStandardMaterial({ color: 0x9a5a3c, roughness: 0.85 }),
    );
    pot.position.y = 0.13;
    pot.castShadow = true;
    g.add(pot);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3d7a3a, roughness: 0.8 });
    for (const [dx, dy, dz, r] of [[0, 0.5, 0, 0.2], [0.13, 0.42, 0.06, 0.13], [-0.12, 0.44, -0.05, 0.14], [0.02, 0.62, -0.02, 0.13]]) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leafMat);
      puff.position.set(dx, dy, dz);
      puff.castShadow = true;
      g.add(puff);
    }
    return { group: g, colliders: [colBoxAt(spot.x, spot.z, 0.5, 0.5)] };
  }

  function makePosterMesh() {
    const cv = document.createElement('canvas');
    cv.width = 96; cv.height = 128;
    const c2 = cv.getContext('2d');
    c2.fillStyle = '#e9e2cc';
    c2.fillRect(0, 0, 96, 128);
    c2.fillStyle = '#1f8a34';
    c2.fillRect(0, 0, 96, 30);
    c2.fillStyle = '#e9e2cc';
    c2.font = 'bold 13px sans-serif';
    c2.fillText('KEEP IT', 22, 13);
    c2.fillText('GREEN', 24, 26);
    c2.fillStyle = '#57795c';
    c2.beginPath(); c2.ellipse(48, 74, 34, 22, 0.2, 0, 7); c2.fill();
    c2.fillStyle = '#8a8069';
    for (let i = 0; i < 3; i++) c2.fillRect(14, 104 + i * 7, 68 - i * 16, 3);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 1.22, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x3d5c40, roughness: 0.8 }),
    );
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(0.84, 1.14),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }),
    );
    sheet.position.z = 0.017;
    frame.add(sheet);
    frame.position.y = 1.85;
    g.add(frame);
    return { group: g, colliders: [] };
  }

  function makeBoardMesh() {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 1.1, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x3d5c40, roughness: 0.8 }),
    );
    const cork = new THREE.Mesh(
      new THREE.PlaneGeometry(1.36, 0.96),
      new THREE.MeshStandardMaterial({ color: 0xa8794e, roughness: 0.95 }),
    );
    cork.position.z = 0.028;
    frame.add(cork);
    const noteMat = new THREE.MeshStandardMaterial({ color: 0xf2eee0, roughness: 0.9 });
    for (const [nx, ny, w, h, rz] of [[-0.4, 0.18, 0.3, 0.34, 0.05], [0.05, 0.1, 0.34, 0.26, -0.04], [0.42, 0.2, 0.26, 0.3, 0.03], [-0.1, -0.26, 0.3, 0.3, -0.06], [0.36, -0.24, 0.3, 0.22, 0.05]]) {
      const note = new THREE.Mesh(new THREE.PlaneGeometry(w, h), noteMat);
      note.position.set(nx, ny, 0.034);
      note.rotation.z = rz;
      frame.add(note);
    }
    const header = new THREE.Mesh(
      new THREE.PlaneGeometry(1.36, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x1f8a34, roughness: 0.8 }),
    );
    header.position.set(0, 0.4, 0.034);
    frame.add(header);
    frame.position.y = 1.8;
    g.add(frame);
    return { group: g, colliders: [] };
  }

  function makePendantMesh(spot, ghost) {
    const g = new THREE.Group();
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.7, 5),
      new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.9 }),
    );
    cord.position.y = SHELL.h - 0.35;
    g.add(cord);
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.3, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2a5a33, roughness: 0.7, side: THREE.DoubleSide }),
    );
    shade.position.y = SHELL.h - 0.78;
    g.add(shade);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xfff2cf, emissive: 0xffe2b0, emissiveIntensity: ghost ? 0 : 1.2 }),
    );
    bulb.position.y = SHELL.h - 0.9;
    g.add(bulb);
    if (!ghost) {
      const light = new THREE.PointLight(0xffe2b0, 9, 9, 1.7);
      light.position.y = SHELL.h - 0.95;
      g.add(light);
    }
    return { group: g, colliders: [] };
  }

  function makeLoungeMesh(spot) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 0.8 });
    const cushion = new THREE.MeshStandardMaterial({ color: 0x3f6d45, roughness: 0.9 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.3, 0.8), wood);
    base.position.y = 0.22;
    base.castShadow = true;
    g.add(base);
    for (let i = -1; i <= 1; i++) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.72), cushion);
      seat.position.set(i * 0.6, 0.44, 0);
      seat.castShadow = true;
      g.add(seat);
      const backC = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.42, 0.16), cushion);
      backC.position.set(i * 0.6, 0.72, -0.31);
      backC.rotation.x = -0.12;
      backC.castShadow = true;
      g.add(backC);
    }
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.8), wood);
      arm.position.set(sx * 1.02, 0.52, 0);
      arm.castShadow = true;
      g.add(arm);
    }
    const tbl = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.08, 0.5), wood);
    tbl.position.set(0, 0.4, 1.05);
    tbl.castShadow = true;
    g.add(tbl);
    for (const [lx, lz] of [[-0.45, 0.85], [0.45, 0.85], [-0.45, 1.25], [0.45, 1.25]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.4, 0.07), wood);
      leg.position.set(lx, 0.2, lz);
      g.add(leg);
    }
    const mug = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.04, 0.09, 8),
      new THREE.MeshStandardMaterial({ color: 0xf2eee0, roughness: 0.7 }),
    );
    mug.position.set(0.2, 0.49, 1.05);
    g.add(mug);
    const worldBox = (lx, lz, w, d) => {
      const sin = Math.sin(spot.ry);
      const cos = Math.cos(spot.ry);
      const bx = spot.x + lx * cos + lz * sin;
      const bz = spot.z - lx * sin + lz * cos;
      const swap = Math.abs(sin) > 0.5;
      return colBoxAt(bx, bz, swap ? 0.95 : w, swap ? w : d);
    };
    return { group: g, colliders: [worldBox(0, 0, 2.2, 0.95), worldBox(0, 1.05, 1.15, 0.6)] };
  }

  const DECOR_BUILDERS = {
    rug1: makeRugMesh, plant1: makePlantMesh, poster1: makePosterMesh,
    board1: makeBoardMesh, light1: makePendantMesh, lounge1: makeLoungeMesh,
  };

  function ghostify(g) {
    g.traverse((o) => {
      if (o.isMesh) {
        o.material = ghostMat;
        o.castShadow = false;
      }
      if (o.isPointLight) o.intensity = 0;
    });
    return g;
  }

  function buildDecorAt(skuId, spotIdx, ghost) {
    const spot = DECOR_SPOTS[skuId][spotIdx];
    const built = DECOR_BUILDERS[skuId](spot, ghost);
    built.group.position.set(spot.x, 0, spot.z);
    built.group.rotation.y = spot.ry;
    if (ghost) ghostify(built.group);
    interior.add(built.group);
    if (!ghost && popNextDecor && popNextDecor.skuId === skuId && popNextDecor.spot === spotIdx) {
      popNextDecor = null;
      tweenScale(built.group, 0.55, 1, 0.28);
    }
    const entry = { group: built.group, colliders: ghost ? [] : built.colliders, prop: null };
    for (const c of entry.colliders) addCol(c);
    const sku = SHOP_CATALOG.find((sk) => sk.id === skuId);
    const wp = L2W(spot.x, spot.z);
    if (!ghost) {
      entry.prop = addProp({
        x: wp.x, z: wp.z, r: 1.9,
        label: () => `${sku.name} — [E] pack it back up`,
        action: () => {
          if (!removeDecor(state, skuId, spotIdx).ok) return;
          rebuildDecor();
          refreshCondition();
          if (hooks.sfx) hooks.sfx('thunk');
          if (hooks.toast) hooks.toast(`${sku.name} packed up — it's back in the backroom.`);
        },
      });
    } else {
      entry.prop = addProp({
        x: wp.x, z: wp.z, r: 1.9,
        label: () => `Place the ${sku.name.toLowerCase()} here — [E]`,
        action: () => {
          const res = placeDecor(state, skuId, spotIdx);
          if (!res.ok) {
            if (hooks.toast) hooks.toast(res.reason || 'Cannot place that here.', 'warn');
            return;
          }
          popNextDecor = { skuId, spot: spotIdx };
          rebuildDecor();
          refreshCondition();
          if (hooks.sfx) hooks.sfx('thunk');
          if (hooks.toast) hooks.toast(`${sku.name} placed — the shop is coming together.`);
        },
      });
    }
    decorObjs.push(entry);
  }

  function rebuildDecor() {
    for (const d of decorObjs) {
      interior.remove(d.group);
      for (const c of d.colliders) removeCol(c);
      if (d.prop) removeProp(d.prop);
    }
    decorObjs.length = 0;
    const reno = state && state.shop && state.shop.reno;
    if (!reno) return;
    for (const d of reno.decor) {
      if (DECOR_BUILDERS[d.skuId] && DECOR_SPOTS[d.skuId] && DECOR_SPOTS[d.skuId][d.spot]) {
        buildDecorAt(d.skuId, d.spot, false);
      }
    }
    for (const skuId of Object.keys(DECOR_BUILDERS)) {
      const inv = state.shop.inventory[skuId];
      if (!inv || inv.back <= 0) continue;
      DECOR_SPOTS[skuId].forEach((spot, idx) => {
        if (!reno.decor.some((d) => d.skuId === skuId && d.spot === idx)) buildDecorAt(skuId, idx, true);
      });
    }
  }

  let decorSig = '';
  function decorSignature() {
    if (!state || !state.shop) return '';
    let sig = state.shop.reno ? String(state.shop.reno.decor.length) : '0';
    for (const skuId of Object.keys(DECOR_BUILDERS)) {
      const inv = state.shop.inventory[skuId];
      sig += ':' + (inv ? inv.back : 0);
    }
    return sig;
  }

  function rebuildReno() {
    for (const c of clutterObjs) {
      interior.remove(c.group);
      removeCol(c.collider);
      removeProp(c.prop);
    }
    clutterObjs.length = 0;
    const reno = state && state.shop && state.shop.reno;
    if (reno) reno.clutter.forEach((pile, idx) => { if (!pile.cleared) buildClutterPile(idx, pile); });
    rebuildDecor();
    decorSig = decorSignature();
    repaintGrime();
    refreshCondition();
    void sheet06Production.applyState(state);
  }

  // --- live stock silhouettes -------------------------------------------------------------
  const stockGroup = new THREE.Group();
  interior.add(stockGroup);
  const stockMeshes = new Map();
  // Stock displays are rebuilt whenever inventory changes. The baked output owns
  // newly cloned/merged geometry, but can also retain an occasional shared merch
  // mesh that bake() deliberately leaves loose. Track only resources created for
  // this rebuildable layer so replacing stock never disposes cached GLB geometry.
  const ownedStockResources = createOwnedStockResources();
  function bakeStockGroup(group) {
    const sourceGeometries = ownedStockResources.snapshotGeometries(group);
    // Authored products carry collision/helper meshes for validation. Their
    // loader visibility must survive batching or those volumes become opaque
    // merchandise-shaped blocks in the finished stock display.
    const baked = merch.bake(group, { visibleOnly: true });
    // bake() clones every mergeable source mesh while reusing its materials.
    // Release only owned procedural source geometry; cached GLB geometry is not
    // in the ownership set, live output materials remain valid, and a no-op bake
    // may safely return the source group itself.
    if (baked !== group) ownedStockResources.disposeGeometries(group);
    ownedStockResources.ownNewGeometries(baked, sourceGeometries);
    return baked;
  }

  // one label texture per SKU, shared by every box mesh of that line
  const labelCache = new Map();
  function ballLabelMat(sku) {
    if (!labelCache.has(sku.id)) {
      const brandOf = { balls1: 'FAIRWAY SUPPLY', balls2: 'IRONWOOD', balls3: 'GREENLINE' };
      const bandOf = { 1: '#8a8272', 2: '#2c3e66', 3: '#1f4a26' };
      const tex = makeProductLabel({
        brand: brandOf[sku.id] || 'FAIRWAY SUPPLY',
        name: sku.name.replace(/ dozen$/i, '').toUpperCase(),
        band: bandOf[sku.tier] || '#1f4a26',
      });
      labelCache.set(sku.id, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    }
    return labelCache.get(sku.id);
  }
  function cartonLabelMat(sku, brand) {
    const key = 'carton:' + sku.id;
    if (!labelCache.has(key)) {
      const tex = makeProductLabel({
        brand, name: sku.name.toUpperCase().slice(0, 13), band: '#57795c', glyph: 'bar',
      });
      labelCache.set(key, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
    }
    return labelCache.get(key);
  }

  // --- ONE ITEM, ONE SLOT ------------------------------------------------------------------
  //
  // This was a 250-line if/else chain in which every line of stock invented its own positions AND
  // its own maximum — `Math.min(count, 12)` here, `Math.min(count, 15)` there — while the sim
  // enforced a completely different capacity out of a per-category table. Nothing compared the two
  // numbers, so a full accessories shelf drew twelve of its twenty-four and looked half empty AT
  // CAPACITY; the ball wall drew fifteen of its twenty-four and padded the gap with a row of boxes
  // standing behind the front row that represented no stock at all. That is the definition of
  // visually faking a full shelf, and the brief says not to.
  //
  // The places live in data now (data/fixtureSlots.js) and the sim's capacity IS the length of that
  // list, so this loop cannot draw the wrong number: it walks the slots and puts one thing in each.
  // Every unit on the shelf is on the shelf. Nothing on the shelf is not a unit.
  const BALL_BOX_GEO = new THREE.BoxGeometry(0.165, 0.12, 0.125);
  const BALL_LABEL_GEO = new THREE.PlaneGeometry(0.145, 0.102);
  // NOT roundedBox: its UVs are planar and world-scaled, which crops a 0..1 label into mush.
  const CARTON_GEO = new THREE.BoxGeometry(0.12, 0.10, 0.11);
  const POLO_TINTS = { polo1: 0x4e7a52, polo2: 0x5b7f9e, jacket2: 0x33455e };
  const BAG_TINTS = [0x53688c, 0x4e8059, 0xb9b3a6, 0x9a7a56];
  const SHOE_DISPLAY_TINTS = [0xf0ead8, 0x78957e, 0x53688c, 0xd8d1bf, 0x315c43, 0xb8aa91];
  const CARTON_BRAND = { tees1: 'CADDIE CLUB', marker1: 'CADDIE CLUB' };
  const skuMats = new Map();
  const ballBoxMats = new Map();

  function skuMat(sku) {
    if (!skuMats.has(sku.id)) {
      const color = new THREE.Color(CAT_COLORS[sku.cat] || 0x999999);
      color.offsetHSL(0, 0, (sku.tier - 2) * 0.09);
      skuMats.set(sku.id, new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    }
    return skuMats.get(sku.id);
  }

  function ballBoxMat(sku) {
    if (!ballBoxMats.has(sku.id)) {
      const plain = new THREE.MeshStandardMaterial({
        color: sku.tier >= 3 ? 0x1f4a26 : sku.tier === 2 ? 0x2c3e66 : 0xf0ead8,
        roughness: 0.72,
      });
      ballBoxMats.set(sku.id, plain);
    }
    return ballBoxMats.get(sku.id);
  }

  function cartonMat(sku) {
    const brand = CARTON_BRAND[sku.id];
    const m = skuMat(sku);
    if (!brand) return m;
    const label = cartonLabelMat(sku, brand);
    return [m, m, m, m, label, m];
  }

  // where the container that a line stands IN sits — derived from the line's own slots, so a
  // basket can never end up somewhere the socks are not
  function slotCentre(skuId) {
    const s = slotsFor(skuId);
    if (!s.length) return { x: 0, y: 0, z: 0 };
    const n = s.length;
    return {
      x: s.reduce((a, p) => a + p.x, 0) / n,
      y: Math.min(...s.map((p) => p.y)),
      z: s.reduce((a, p) => a + p.z, 0) / n,
    };
  }

  // the basket / barrel a line lives in — furniture, drawn only under the stock it actually holds
  function stockHolder(sku, count) {
    if (sku.id === 'sock1') {
      // the Sheet-03 slatwall shelves front their rolls in the open — a slot
      // without a `base` board wants no basket under it
      if (!slotsFor('sock1').length || slotsFor('sock1')[0].base == null) return null;
      // one basket per board that has socks in it: an empty basket on the top shelf is a prop
      const g = new THREE.Group();
      const used = slotsFor('sock1').slice(0, count);
      const boards = [...new Set(used.map((s) => s.base))];
      for (const base of boards) {
        const on = used.filter((s) => s.base === base);
        const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.19, 0.14, 12), woodMat);
        basket.position.set(
          on.reduce((a, s) => a + s.x, 0) / on.length,
          base + 0.07,
          on[0].z,
        );
        g.add(basket);
      }
      return g;
    }
    if (sku.id === 'umb1') {
      const c = slotCentre('umb1');
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.5, 10), woodMat);
      b.position.set(c.x, c.y, c.z);
      return b;
    }
    return null;
  }

  // one unit of stock, posed in its slot
  function makeStockItem(sku, s, i) {
    const id = sku.id;

    if (sku.cat === 'clubs') {
      // A club is a shaft, a grip and a HEAD, and the head was the tell: a driver was a squashed
      // sphere and an iron a flat tab. The heads are modelled (vendor/models/clubhouse/head_*.glb),
      // pivoted at the shaft entry, so they hang off the tip of the shaft.
      //
      // Two rack poses share this build: head at the slot with the shaft rising
      // (putter grooves), and headUp — the Sheet-03 club rack — where the club
      // stands grip-down in the trough and the slot marks the HEAD seated on
      // the comb rail, so the shaft grows DOWNWARD from it.
      const g = new THREE.Group();
      const isDriver = id.startsWith('driver');
      const headModel = isDriver ? 'head_driver'
        : id.startsWith('putter') ? 'head_putter'
          : id.startsWith('wedge') ? 'head_wedge' : 'head_iron';
      const dir = s.headUp ? -1 : 1;
      const shaft = new THREE.Mesh(
        ownedStockResources.geometry(new THREE.CylinderGeometry(0.0075, 0.0105, s.len, 10)),
        mats.merchShaft,
      );
      shaft.position.set(
        s.x + dir * Math.sin(s.lean) * s.len / 2,
        s.y + dir * Math.cos(s.lean) * s.len / 2,
        s.z,
      );
      shaft.rotation.z = -s.lean;
      shaft.castShadow = true;
      const gripAlong = s.headUp ? s.len - 0.14 : s.len - 0.10;
      const grip = new THREE.Mesh(
        ownedStockResources.geometry(new THREE.CylinderGeometry(0.0135, 0.0115, 0.24, 8)),
        mats.merchRubber,
      );
      grip.position.set(
        s.x + dir * Math.sin(s.lean) * gripAlong,
        s.y + dir * Math.cos(s.lean) * gripAlong,
        s.z,
      );
      grip.rotation.z = -s.lean;
      const accentAlong = 0.075;
      const accent = new THREE.Mesh(
        ownedStockResources.geometry(new THREE.CylinderGeometry(0.0125, 0.0125, 0.036, 8)),
        skuMat(sku),
      );
      accent.position.set(
        s.x + dir * Math.sin(s.lean) * accentAlong,
        s.y + dir * Math.cos(s.lean) * accentAlong,
        s.z,
      );
      accent.rotation.z = -s.lean;
      g.add(shaft, grip, accent);
      const head = merch.instantiate(headModel);
      if (head) {
        head.position.set(s.x, s.y, s.z);
        head.rotation.z = -s.lean;
        head.rotation.y = s.ry;
        g.add(head);
      }
      return g;
    }

    if (sku.cat === 'balls') {
      // Six BoxGeometry materials prevented the stock baker from merging these
      // repeated cartons.  A shared body plus one shopper-facing label plane
      // keeps the same visual identity while collapsing each SKU to two draws.
      const carton = new THREE.Group();
      const box = new THREE.Mesh(BALL_BOX_GEO, ballBoxMat(sku));
      box.position.set(s.x, s.y, s.z);
      box.castShadow = true;
      const label = new THREE.Mesh(BALL_LABEL_GEO, ballLabelMat(sku));
      label.position.set(s.x, s.y, s.z + 0.0626);
      carton.add(box, label);
      return carton;
    }

    if (POLO_TINTS[id]) {
      // THE WORST ASSET IN THE SHOP, per the audit: a hanging polo was a 0.3 x 0.38 x 0.035 box
      // with two box sleeves stuck on at 30 degrees. Both the hanging and the folded shirts are
      // modelled garments now, and the tints sit on the room's palette.
      const tint = s.tint ?? POLO_TINTS[id];
      if (s.folded) {
        const fold = merch.instantiate(
          id === 'jacket2' ? 'checkout_product_folded_jacket' : 'checkout_product_folded_polo',
          { tint },
        );
        if (!fold) return null;
        fold.position.set(s.x, s.y, s.z);
        fold.rotation.y = s.ry || 0;
        return fold;
      }
      const shirt = merch.instantiate(
        id === 'jacket2' ? 'checkout_product_hanging_jacket'
          : id === 'polo2' ? 'checkout_product_hanging_polo' : 'polo_hanging',
        { tint },
      );
      if (!shirt) return null;
      shirt.position.set(s.x, s.y, s.z);   // the model's pivot is the hanger HOOK
      shirt.rotation.y = s.ry || 0;
      return shirt;
    }

    if (id === 'cap1') {
      const cap = merch.instantiate('checkout_product_cap', { tint: s.tint ?? 0x315c43 });
      if (!cap) return null;
      cap.position.set(s.x, s.y, s.z);
      // yaw first (bill runs +x on the model), then nose the crown down over
      // the peg when the slot asks for it (the Sheet-03 hat wall)
      cap.rotation.order = 'YXZ';
      cap.rotation.set(s.rx || 0, s.ry || 0, 0);
      return cap;
    }

    if (id === 'glove1') {
      // STOOD UP, not laid flat. Flat on a board at chest height they are edge-on to a standing
      // player and a full shelf of them renders as a row of white slivers.
      const glove = merch.instantiate('checkout_product_glove', { tint: 0xf0ead8 });
      if (!glove) return null;
      glove.position.set(s.x, s.y, s.z);
      glove.rotation.set(-0.08, s.ry || 0, 0);
      return glove;
    }

    if (id === 'sock1') {
      const socks = merch.instantiate('checkout_product_sock_pair', { tint: 0xd8d1bf });
      if (!socks) return null;
      socks.position.set(s.x, s.y, s.z);
      socks.rotation.y = s.ry || 0;
      return socks;
    }

    if (id === 'towel1') {
      const towel = merch.instantiate('checkout_product_towel_roll', { tint: 0x78957e });
      if (!towel) return null;
      towel.position.set(s.x, s.y, s.z);
      towel.rotation.y = s.ry || 0;
      return towel;
    }

    if (id === 'umb1') {
      const umbrella = merch.instantiate('checkout_product_umbrella', { tint: 0x315c43 });
      if (!umbrella) return null;
      umbrella.position.set(s.x, s.y + 0.42, s.z);
      umbrella.rotation.z = Math.PI / 2 + (s.lean || 0);
      return umbrella;
    }

    if (id === 'range2') {
      // Project-owned authored optic; the slot yaw presents its objective lens.
      const rf = merch.instantiate('checkout_product_rangefinder');
      if (!rf) return null;
      rf.position.set(s.x, s.y, s.z);
      rf.rotation.y = s.ry || 0;
      return rf;
    }

    if (id === 'shoe1') {
      // A slot is either one boxed retail unit or one authored try-on pair. The
      // loose samples vary only their palette; inventory and checkout identity
      // remain the single shoe1 SKU represented by its Fairhollow retail box.
      const shoe = merch.instantiate(
        s.boxed ? 'checkout_product_shoe_box' : 'checkout_product_shoe_pair',
        s.boxed ? {} : { tint: SHOE_DISPLAY_TINTS[i % SHOE_DISPLAY_TINTS.length] },
      );
      if (!shoe) return null;
      shoe.position.set(s.x, s.y, s.z);
      shoe.rotation.set(s.rx || 0, s.ry || 0, 0);
      return shoe;
    }

    if (id === 'bag1') {
      // The modelled bag ships WITH its fan of clubs, because that fan is the whole silhouette:
      // a golf bag with nothing in it is just a bin (ref 7).
      const bag = merch.instantiate('checkout_product_stand_bag', { tint: BAG_TINTS[i % 4] });
      if (!bag) return null;
      const display = new THREE.Group();
      display.position.set(s.x, s.y, s.z);
      display.rotation.set(s.lean || 0, s.ry || 0, 0);
      bag.rotation.z = Math.PI / 2;
      bag.position.y = 0.36;
      display.add(bag);
      for (let club = 0; club < 3; club++) {
        const lean = (club - 1) * 0.07;
        const x = (club - 1) * 0.045;
        const z = (club % 2) * 0.025 - 0.012;
        const shaft = new THREE.Mesh(
          ownedStockResources.geometry(new THREE.CylinderGeometry(0.006, 0.008, 0.58, 8)),
          mats.merchShaft,
        );
        shaft.position.set(x, 0.86, z);
        shaft.rotation.z = lean;
        display.add(shaft);
        const head = merch.instantiate(['head_driver', 'head_iron', 'head_putter'][club]);
        if (head) {
          head.position.set(x + Math.sin(lean) * 0.29, 1.15, z);
          head.rotation.z = lean;
          head.rotation.y = (club - 1) * 0.18;
          display.add(head);
        }
      }
      return display;
    }

    if (id === 'tees1' || id === 'marker1') {
      const model = id === 'tees1' ? 'checkout_product_tee_pouch' : 'checkout_product_marker_blister';
      const packageItem = merch.instantiate(model);
      if (!packageItem) return null;
      packageItem.position.set(s.x, s.y, s.z);
      packageItem.rotation.set(s.hangingPackage ? -0.04 : 0, s.ry || 0, 0);
      return packageItem;
    }

    if (id === 'water1' || id === 'snack1') {
      const model = id === 'water1'
        ? 'provisions_fairway_spring_water'
        : 'provisions_bunker_bites_chips';
      const product = merch.instantiateRaw(model);
      if (!product) return null;
      product.position.set(s.x, s.y, s.z);
      product.rotation.y = s.ry || 0;
      return product;
    }

    // cartoned smalls: cream cartons with a branded band, neatly fronted
    const item = new THREE.Mesh(CARTON_GEO, cartonMat(sku));
    item.position.set(s.x, s.y, s.z);
    item.castShadow = true;
    return item;
  }

  function rebuildStock() {
    clearStockFlights();   // any airborne placements land instantly in the bake
    for (const g of stockMeshes.values()) {
      stockGroup.remove(g);
      ownedStockResources.dispose(g);
    }
    stockMeshes.clear();
    const inv = state.shop.inventory;

    for (const f of placedFixtures(state)) {
      const anchor = fixtureAnchors.get(f.id);
      if (!anchor) continue;

      for (const skuId of f.skus) {
        const sku = SHOP_CATALOG.find((s) => s.id === skuId);
        if (!sku) continue;
        const slots = slotsFor(skuId).map((slot) => resolveAuthoredFixtureSlot(anchor, slot));
        // the shelf cannot hold more than it has places for — the sim enforces the same number,
        // so this min() is a belt, not a braces: it can only ever bite on a corrupted save
        const count = Math.min(inv[skuId] ? inv[skuId].shelf : 0, slots.length);
        const g = new THREE.Group();
        if (count > 0) {
          const holder = stockHolder(sku, count);
          if (holder) g.add(holder);
          for (let i = 0; i < count; i++) {
            const item = makeStockItem(sku, slots[i], i);
            if (item) g.add(item);
          }
        }
        // Collapse the whole display into one mesh per material before it goes in. A shelf of 15
        // ball boxes was 15 draw calls; a rack of 12 clubs was 36. This happens on restock, not
        // per frame.
        const baked = bakeStockGroup(g);
        baked.position.copy(anchor.position);
        baked.rotation.copy(anchor.rotation);
        baked.visible = !hiddenFixtureStock.has(f.id);
        stockGroup.add(baked);
        stockMeshes.set(f.id + ':' + skuId, baked);
      }

      // the feature display shows whatever the featured category has on
      // shelves, dressed onto the Sheet-04 merch table's slot grid: six
      // spots on the walnut top (0.75), two more on the lower shelf (0.294)
      if (f.kind === 'feature' && !(f.skus && f.skus.length)) {
        const cat = state.shop.featureCategory;
        const g = new THREE.Group();
        // Real product proxies of the featured category's in-stock lines — the SAME
        // Blender family the register belt and the apparel table use — instead of the
        // category-coloured cubes this used to stack (a feature of golf balls read as a
        // pile of plain white boxes). Round-robin across the in-stock SKUs for variety.
        const inStock = SHOP_CATALOG.filter((s) => s.cat === cat && inv[s.id] && inv[s.id].shelf > 0);
        const total = inStock.reduce((a, s) => a + inv[s.id].shelf, 0);
        const show = Math.min(total, 8);
        const TOP_SPOTS = [[-0.45, -0.20], [0, -0.20], [0.45, -0.20], [-0.45, 0.20], [0, 0.20], [0.45, 0.20]];
        const LOW_SPOTS = [[-0.45, 0], [0.45, 0]];
        for (let i = 0; i < show && inStock.length; i++) {
          const sku = inStock[i % inStock.length];
          const onTop = i < TOP_SPOTS.length;
          const [sx, sz] = onTop ? TOP_SPOTS[i] : LOW_SPOTS[i - TOP_SPOTS.length];
          const built = buildCatalogProductProxy({ sku, merch, mats, resources: ownedStockResources });
          const item = built.root;
          item.scale.setScalar(0.9);
          item.position.set(sx, onTop ? 0.751 : 0.295, sz);
          item.rotation.y = ((i % 3) - 1) * 0.28;
          item.traverse((o) => { if (o.isMesh) o.castShadow = true; });
          g.add(item);
        }
        // a small angled "featured" card at the back of the deck
        const sign = new THREE.Mesh(
          ownedStockResources.geometry(new THREE.BoxGeometry(0.3, 0.16, 0.02)),
          ownedStockResources.material(new THREE.MeshStandardMaterial({ color: 0x1f8a34, roughness: 0.8 })),
        );
        sign.position.set(0, 0.83, -0.02);
        sign.rotation.x = -0.2;
        g.add(sign);
        g.position.copy(anchor.position);
        g.rotation.copy(anchor.rotation);
        g.visible = !hiddenFixtureStock.has(f.id);
        stockGroup.add(g);
        stockMeshes.set(f.id + ':feature', g);
      }

      // The backroom shelving is STORAGE, not a sales fixture: it shows the volume of stock behind
      // the door as cases, not one case per unit (a hundred golf balls do not sit on that shelf as
      // a hundred boxes, they sit as the cases they came in). It is an honest representation of a
      // quantity rather than a count of items, and the difference is stated rather than hidden.
      if (f.kind === 'backshelf' && f.id !== 'backshelf_e2') {
        const g = new THREE.Group();
        const totalBack = SHOP_CATALOG.reduce((a, s) => a + (inv[s.id] ? inv[s.id].back : 0), 0);
        const show = Math.min(Math.ceil(totalBack / 6), 12);
        // case columns line up with the Sheet-04 stock_shelving modules; the
        // case bases sit exactly on the upper three board tops (the ground
        // board belongs to the carton dressing)
        const cols = f.short ? [-0.31, 0.31] : [-0.93, -0.31, 0.31, 0.93];
        for (let i = 0; i < show; i++) {
          const bx = cols[i % cols.length];
          const by = [0.6455, 1.1455, 1.6455][Math.floor(i / cols.length) % 3];
          const caseB = new THREE.Mesh(
            ownedStockResources.geometry(new THREE.BoxGeometry(0.5, 0.36, 0.44)),
            i % 2 ? cardboard : cardboardDark,
          );
          caseB.position.set(bx, by + 0.18, 0);
          caseB.rotation.y = (i % 3) * 0.1 - 0.1;
          caseB.castShadow = true;
          g.add(caseB);
        }
        g.position.copy(anchor.position);
        g.rotation.copy(anchor.rotation);
        g.visible = !hiddenFixtureStock.has(f.id);
        stockGroup.add(g);
        stockMeshes.set(f.id + ':back', g);
      }
    }
    // stockGroup is mounted while empty. Every direct restock and inventory
    // poll populates below that existing root, so enforce the roof policy after
    // the complete rebuild rather than relying on interior.add().
    suppressInteriorSunShadows(stockGroup);
  }

  let stockSig = '';
  function stockSignature() {
    const inv = state.shop.inventory;
    let sig = state.shop.featureCategory || '';
    for (const s of SHOP_CATALOG) {
      const e = inv[s.id];
      sig += ':' + (e ? e.shelf + '.' + e.back : '0');
    }
    return sig;
  }

  // Read-only production/QA evidence for the rebuildable stock layer. Stock
  // bakes are allowed to return their source Group when there is nothing
  // mergeable, so looking only for the `merchBaked` marker is not a reliable
  // way to prove that a fixture has visible geometry. Keep that implementation
  // detail private and expose stable counts keyed by the authored fixture id.
  function stockDisplayDiagnostics() {
    const displays = [];
    for (const [key, root] of stockMeshes) {
      let meshes = 0;
      let triangles = 0;
      root.traverseVisible((object) => {
        if (!object.isMesh || !object.geometry) return;
        meshes += 1;
        triangles += object.geometry.index
          ? object.geometry.index.count / 3
          : (object.geometry.attributes?.position?.count || 0) / 3;
      });
      const separator = key.indexOf(':');
      displays.push({
        key,
        fixtureId: separator >= 0 ? key.slice(0, separator) : key,
        stockId: separator >= 0 ? key.slice(separator + 1) : '',
        visible: root.visible && stockGroup.visible,
        meshes,
        triangles,
        position: {
          x: root.position.x,
          y: root.position.y,
          z: root.position.z,
        },
      });
    }
    return {
      displays,
      hiddenFixtureIds: [...hiddenFixtureStock].sort(),
    };
  }

  // --- the vacuum hook (the wand mesh rides the walk camera, courseScene-side) ----------
  const MOTES = 26;
  const moteState = [];
  const motePos = new Float32Array(MOTES * 3);
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    color: 0xa2937c, size: 0.05, transparent: true, opacity: 0.85, depthWrite: false,
  }));
  motes.visible = false;
  motes.frustumCulled = false;
  scene.add(motes);
  for (let i = 0; i < MOTES; i++) moteState.push({ t: Math.random(), ox: 0, oz: 0 });
  let cleanClock = 0;
  let moteFade = 0;

  // --- loose debris: swept into piles, then carried away ------------------------------------
  //
  // The floor grime mask handles ground-in dirt. Debris is the other half — leaves, grit and
  // wrappers that a broom PUSHES rather than erases. Piles are drawn as small instanced clumps
  // whose scale tracks the cluster amount, so a heap you have worked twice visibly reads as a heap.
  // The wet and solution fields are authored at 0.25 yd — far finer than the 13x8 (=104 cell)
  // grime grid they sit over, because a wet stripe you can see the edge of is the whole point of
  // mopping. They are new save fields, so unlike the grime grid they carry no migration debt.
  const WET_GRID = wetGridForRoom(RENO.room);
  // cleanGrimeAt works in room-CENTRED yards; the wet field is indexed from its corner.
  const toWet = (lx, lz) => ({ x: lx + RENO.room.w / 2, z: lz + RENO.room.d / 2 });

  ensureDebris(state);
  ensureWet(state, WET_GRID.w, WET_GRID.h);
  if (debrisState(state).length === 0 && !state.shop.reno.debrisSeeded) {
    // a property nobody has run for two years does not have a clean floor
    seedDebris(state, 30, SHELL.w - 3, SHELL.d - 3, 20260718);
    state.shop.reno.debrisSeeded = true;
  }

  const DEBRIS_CAP = 96;
  const debrisGeo = new THREE.IcosahedronGeometry(0.085, 0);
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x6b5a3c, roughness: 0.95 });
  const debrisMesh = new THREE.InstancedMesh(debrisGeo, debrisMat, DEBRIS_CAP);
  debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  debrisMesh.castShadow = false;
  debrisMesh.receiveShadow = false;
  debrisMesh.frustumCulled = false;
  debrisMesh.count = 0;
  interior.add(debrisMesh);

  const _dm = new THREE.Matrix4();
  const _dq = new THREE.Quaternion();
  const _dp = new THREE.Vector3();
  const _ds = new THREE.Vector3();
  const _dUp = new THREE.Vector3(0, 1, 0);
  let wetVisualDirty = false;
  let wetRepaintClock = 0;
  function refreshDebrisVisual() {
    const list = debrisState(state);
    const n = Math.min(list.length, DEBRIS_CAP);
    for (let i = 0; i < n; i++) {
      const d = list[i];
      // a pile spreads as it grows rather than becoming one giant pebble
      const s = Math.min(2.4, 0.55 + Math.sqrt(d.a) * 1.5);
      // The `interior` group is already at floor height — dirt.js lays its grime overlay at a
      // plain 0.026. Adding FLOOR_TOP here floated every pile 0.3 yd off the boards.
      _dp.set(d.x, 0.012 * s, d.z);
      _dq.setFromAxisAngle(_dUp, (d.x * 7.3 + d.z * 3.1) % Math.PI);
      _ds.set(s, s * 0.55, s);
      _dm.compose(_dp, _dq, _ds);
      debrisMesh.setMatrixAt(i, _dm);
    }
    debrisMesh.count = n;
    debrisMesh.instanceMatrix.needsUpdate = true;
  }
  refreshDebrisVisual();

  // --- the wet floor ------------------------------------------------------------------------
  //
  // Mopping had no visible result at all: the sim recorded water, the player saw nothing, and the
  // only feedback was the condition number ticking up. Water reads as two things at once — it
  // DARKENS the boards and it makes them GLOSSY — so this is one overlay that does both, sitting
  // just proud of the grime layer.
  //
  // It is drawn at the wet field's own resolution (82x52) and scaled up by the GPU with linear
  // filtering: far cheaper than a 1024px canvas, and it gives exactly the soft-edged puddle the
  // brush falloff already computes.
  const wetCanvas = document.createElement('canvas');
  wetCanvas.width = WET_GRID.w;
  wetCanvas.height = WET_GRID.h;
  const wetCtx = wetCanvas.getContext('2d');
  const wetTex = new THREE.CanvasTexture(wetCanvas);
  wetTex.colorSpace = THREE.SRGBColorSpace;
  wetTex.minFilter = THREE.LinearFilter;
  wetTex.magFilter = THREE.LinearFilter;
  const wetPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(RENO.room.w, RENO.room.d),
    new THREE.MeshStandardMaterial({
      map: wetTex,
      transparent: true,
      depthWrite: false,
      roughness: 0.18, // wet boards are glossy; the dry floor around them is roughness 1
      metalness: 0.0,
    }),
  );
  wetPlane.rotation.x = -Math.PI / 2;
  wetPlane.position.y = 0.028; // just above dirt.js's grime overlay at 0.026
  wetPlane.renderOrder = 4;
  wetPlane.visible = false;
  interior.add(wetPlane);

  function repaintWet() {
    const wet = state.shop.reno.wet;
    const sol = state.shop.reno.solution;
    if (!Array.isArray(wet)) return;
    const img = wetCtx.createImageData(WET_GRID.w, WET_GRID.h);
    let any = false;
    for (let i = 0; i < wet.length; i++) {
      const w = wet[i] || 0;
      const s = sol ? (sol[i] || 0) : 0;
      const a = Math.min(1, w * 0.55 + s * 0.42);
      if (a <= 0.004) continue;
      any = true;
      const p = i * 4;
      // water darkens toward a cool slate; solution skews it paler and bluer
      img.data[p] = 44 + s * 90;
      img.data[p + 1] = 52 + s * 96;
      img.data[p + 2] = 58 + s * 104;
      img.data[p + 3] = Math.round(a * 235);
    }
    wetCtx.putImageData(img, 0, 0);
    wetTex.needsUpdate = true;
    wetPlane.visible = any;
  }
  repaintWet();

  /**
   * One entry point for every cleaning tool. The caller passes the tool's own contact or nozzle
   * point in WORLD space — read from the socket on the viewmodel, never guessed from the camera —
   * plus the direction it is being worked in.
   */
  function cleanWithTool(toolId, wx, wz, dirX, dirZ, dt) {
    const def = CLEANING_TOOLS[toolId];
    if (!def) return { did: 0, kind: null };
    const l = W2L(wx, wz);
    let did = 0;

    switch (def.toolClass) {
      case TOOL_CLASS.SWEEP: {
        // a broom moves debris; it never deletes it
        did = sweepAt(state, l.x, l.z, dirX, dirZ, def.radius, dt).moved;
        if (did > 0) refreshDebrisVisual();
        return { did, kind: 'sweep' };
      }
      case TOOL_CLASS.SCOOP: {
        did = collectAt(state, l.x, l.z, def.radius);
        if (did > 0) {
          refreshDebrisVisual();
          state.shop.reno.pan = Math.round(((state.shop.reno.pan || 0) + did) * 1000) / 1000;
        }
        return { did, kind: 'scoop' };
      }
      case TOOL_CLASS.SUCTION: {
        // debris is drawn in and swallowed only at the mouth; ground-in dust comes up under the head
        did = suckAt(state, l.x, l.z, def.radius, dt);
        const dust = cleanGrimeAt(state, l.x, l.z, 0.5 * dt);
        if (did > 0) refreshDebrisVisual();
        return { did: did + dust.cleaned, kind: 'suction', picked: did > 0 };
      }
      case TOOL_CLASS.STROKE: {
        if (def.id === 'mop') {
          const res = cleanGrimeAt(state, l.x, l.z, def.strength * 0.55 * dt);
          const wp = toWet(l.x, l.z);
          wetAt(state, WET_GRID, wp.x, wp.z, def.radius, dt * 1.6);
          wetVisualDirty = true;
          return { did: res.cleaned, kind: 'mop' };
        }
        // cloth and sponge: the cloth only lifts what the spray has already loosened
        const wp = toWet(l.x, l.z);
        const sol = solutionLevel(state, WET_GRID, wp.x, wp.z);
        if (def.needsSolution && sol < SOLUTION_MIN) return { did: 0, kind: 'dry', blocked: true };
        const gain = def.needsSolution ? 1 : 0.55 + sol * 0.8;
        const res = cleanGrimeAt(state, l.x, l.z, def.strength * gain * 0.5 * dt);
        if (res.cleaned > 0) {
          consumeSolution(state, WET_GRID, wp.x, wp.z, def.radius, dt * 0.5);
          wetVisualDirty = true;
        }
        return { did: res.cleaned, kind: def.id };
      }
      case TOOL_CLASS.SPRAY: {
        const sp = toWet(l.x, l.z);
        did = solutionAt(state, WET_GRID, sp.x, sp.z, def.radius, dt * 2.2);
        wetVisualDirty = true;
        return { did, kind: 'spray' };
      }
      case TOOL_CLASS.CARRY: {
        did = collectAt(state, l.x, l.z, def.radius);
        if (did > 0) {
          refreshDebrisVisual();
          state.shop.reno.bag = Math.round(((state.shop.reno.bag || 0) + did) * 1000) / 1000;
        }
        return { did, kind: 'bag' };
      }
      default:
        return { did: 0, kind: null };
    }
  }

  function vacuumAt(wx, wz, dt) {
    const l = W2L(wx, wz);
    const res = cleanGrimeAt(state, l.x, l.z, 0.5 * dt);
    if (res.cleaned > 0 && state.tutorial) tutorialFlag(state, 'vacuumed');
    cleanClock += dt;
    if (cleanClock > 0.16) {
      cleanClock = 0;
      if (res.cleaned > 0) repaintGrime();
      refreshCondition();
    }
    moteFade = 0.2;
    motes.visible = true;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const noz = camera.position.clone().add(fwd.multiplyScalar(0.8));
    noz.y -= 0.35;
    for (let i = 0; i < MOTES; i++) {
      const mo = moteState[i];
      mo.t += dt * (1.6 + (i % 5) * 0.14);
      if (mo.t >= 1) {
        mo.t = 0;
        mo.ox = (Math.random() - 0.5) * 1.1;
        mo.oz = (Math.random() - 0.5) * 1.1;
      }
      const sx = wx + mo.ox;
      const sz = wz + mo.oz;
      motePos[i * 3] = sx + (noz.x - sx) * mo.t;
      motePos[i * 3 + 1] = floorY + 0.03 + (noz.y - floorY - 0.03) * mo.t * mo.t;
      motePos[i * 3 + 2] = sz + (noz.z - sz) * mo.t;
    }
    moteGeo.attributes.position.needsUpdate = true;
  }

  function vacuumLabelAt(wx, wz) {
    const l = W2L(wx, wz);
    const reno = state.shop && state.shop.reno;
    if (!reno) return null;
    const cx = Math.floor(((l.x + RENO.room.w / 2) / RENO.room.w) * RENO.grid.w);
    const cy = Math.floor(((l.z + RENO.room.d / 2) / RENO.room.d) * RENO.grid.h);
    if (cx < 0 || cx >= RENO.grid.w || cy < 0 || cy >= RENO.grid.h) return 'Vacuum — aim at the floor';
    const d = reno.grime[cy * RENO.grid.w + cx];
    return d > 0.05 ? `Vacuum — this patch: ${Math.round(d * 100)}% dirty · hold LMB` : 'Vacuum — this patch is clean';
  }

  // --- physical deliveries: boxes on the pad, in your arms, in the stockroom ------------
  //
  // The whole retail loop is physical here: a labelled carton with tape you run a cutter down, two
  // flaps that pivot open, the actual product visible inside, and an armful you carry to a shelf.
  // Nothing teleports. The state lives in the sim (sim/deliveries.js, sim/stocking.js); this draws
  // it and turns [E] into the right verb for whatever the box is currently doing.
  const boxGroup = new THREE.Group();
  boxGroup.name = 'DeliveryBoxWorldRoot';
  scene.add(boxGroup);
  let boxPlacementMode = null;
  let placementBoxId = null;
  let placementDismissedBoxId = null;
  let carriedBoxMesh = null;
  let carriedGoodsMesh = null;
  const boxProps = new Map();   // id -> prop, reused across rebuilds so a hold survives a redraw
  const boxCols = new Map();    // id -> { col, sig } — a set-down box is a real obstacle, tracked here
  const boxViews = new Map();
  const deliveryBoxTransfers = new Map();
  const deliveryBoxTransferHistory = [];
  let deliveryTransferBatch = null;
  const deliveryPendingBoxIds = new Set();
  const deliveryLoadPlansByArrivalId = new Map();
  let deliveryActiveLoad = null;
  let deliveryCargoSnapshot = Object.freeze({
    orderId: null, arrivalId: null, loadId: null, loadIndex: null, loadCount: 0,
    planned: [], overflowBoxIds: [],
  });
  let exposedPadBoxIds = new Set(); // only the top carton in each pallet stack is reachable
  const boxOpeningAnimations = new Set();
  const boxOpeningPhases = new Map();
  const boxFlattenAnimations = new Set();
  let recyclingDrop = null;
  let boxSig = '';
  const placementOcclusionRaycaster = new THREE.Raycaster();
  const placementOcclusionHits = [];
  const placementOcclusionRoots = [];
  const PLACEMENT_OCCLUSION_TOLERANCE = 0.065;
  let placementOccluderDistance = null;
  let placementOccluderName = null;
  let placementOcclusionChecks = 0;

  // Medium-carton carry pose: the carton keeps its real scale and two hands
  // visibly brace its side edges. The hands are camera-local and hidden the
  // instant the carton is set down, so they never become world props.
  const carriedBoxHands = new THREE.Group();
  carriedBoxHands.name = 'DeliveryBoxCarryHands';
  carriedBoxHands.visible = false;
  camera.add(carriedBoxHands);
  const DELIVERY_CARRY_RENDER_LAYER = 30;
  let deliveryCarryLightsPrepared = false;

  function setDeliveryCarryOverlay(root, enabled) {
    if (!root) return;
    root.traverse((object) => {
      if (enabled) {
        if (!Object.hasOwn(object.userData, 'deliveryCarryBaseLayerMask')) {
          object.userData.deliveryCarryBaseLayerMask = object.layers.mask;
        }
        object.layers.set(DELIVERY_CARRY_RENDER_LAYER);
      } else if (Object.hasOwn(object.userData, 'deliveryCarryBaseLayerMask')) {
        object.layers.mask = object.userData.deliveryCarryBaseLayerMask;
        delete object.userData.deliveryCarryBaseLayerMask;
      }
    });
  }

  // First-person cargo uses a second, layer-isolated draw after the complete
  // world pass. Clearing depth inside the world pass exposes transparent sky,
  // window, and dust sprites through solid clubhouse walls; isolating the
  // camera-local carton and hands prevents that leak while still preserving
  // their own depth ordering. The world scene remains authoritative, so normal
  // scene diagnostics and the existing box-view cache continue to see the root.
  function renderDeliveryCarryOverlay() {
    if (!renderer || (!carriedBoxMesh && !carriedGoodsMesh)) return false;
    if (!deliveryCarryLightsPrepared) {
      scene.traverse((object) => {
        if (object.isLight) object.layers.enable(DELIVERY_CARRY_RENDER_LAYER);
      });
      deliveryCarryLightsPrepared = true;
    }
    const cameraLayerMask = camera.layers.mask;
    const autoClear = renderer.autoClear;
    const renderTarget = renderer.getRenderTarget();
    camera.layers.set(DELIVERY_CARRY_RENDER_LAYER);
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.clearDepth();
    renderer.render(scene, camera);
    renderer.setRenderTarget(renderTarget);
    renderer.autoClear = autoClear;
    camera.layers.mask = cameraLayerMask;
    return true;
  }
  const carryHandSkin = new THREE.MeshStandardMaterial({ color: 0xd9a97e, roughness: 0.82 });
  const carryHandCuff = new THREE.MeshStandardMaterial({ color: 0x2f4a35, roughness: 0.9 });
  const carryPalmGeo = new THREE.CapsuleGeometry(0.034, 0.075, 3, 7);
  const carryFingerGeo = new THREE.BoxGeometry(0.055, 0.078, 0.038);
  const carrySleeveGeo = new THREE.CylinderGeometry(0.045, 0.052, 0.22, 8);
  for (const side of [-1, 1]) {
    const hand = new THREE.Group();
    hand.userData.side = side;
    const palm = new THREE.Mesh(carryPalmGeo, carryHandSkin);
    palm.rotation.x = Math.PI * 0.5;
    const fingers = new THREE.Mesh(carryFingerGeo, carryHandSkin);
    fingers.position.set(-side * 0.018, -0.028, -0.018);
    fingers.rotation.z = side * 0.45;
    const sleeve = new THREE.Mesh(carrySleeveGeo, carryHandCuff);
    // Aim the short forearm down toward the player instead of straight down
    // camera Z. The former end-on cylinder read as a detached octagonal mitten;
    // this diagonal keeps one end at the wrist and carries the other naturally
    // toward the bottom of frame without obscuring the carton identity.
    sleeve.rotation.x = -1.08;
    sleeve.position.set(0, -0.05, 0.095);
    hand.add(palm, fingers, sleeve);
    hand.traverse((object) => { if (object.isMesh) object.renderOrder = 2002; });
    carriedBoxHands.add(hand);
  }
  setDeliveryCarryOverlay(carriedBoxHands, true);

  function poseCarriedBoxHands(box) {
    const profile = deliveryBoxCarryProfile(box);
    for (const hand of carriedBoxHands.children) {
      const side = hand.userData.side;
      const hands = profile.hands;
      hand.position.set(
        side * hands.supportX,
        hands.y + side * hands.ySkew,
        hands.z + side * hands.zSkew,
      );
      hand.rotation.set(
        hands.rotationX,
        side * hands.rotationY,
        side * hands.rotationZ,
      );
    }
    carriedBoxHands.visible = true;
  }

  function poseCarriedGoodsHands(profile = 'standard') {
    for (const hand of carriedBoxHands.children) {
      const side = hand.userData.side;
      if (profile === 'long-clubs') {
        hand.position.set(side * 0.38, -0.34 - side * 0.075, -0.91);
        hand.rotation.set(-0.24, side * 0.10, side * -0.34);
      } else if (profile === 'bulky-stand-bag' || profile === 'bulky-single') {
        hand.position.set(0.34 + side * 0.12, -0.50 - side * 0.025, -1.04);
        hand.rotation.set(-0.20, side * 0.10, side * -0.34);
      } else if (profile === 'long-accessories') {
        hand.position.set(side * 0.31, -0.34 - side * 0.04, -0.86);
        hand.rotation.set(-0.24, side * 0.10, side * -0.35);
      } else if (profile === 'bottle-bundle') {
        hand.position.set(0.10 + side * 0.19, -0.43, -0.89);
        hand.rotation.set(-0.28, side * 0.16, side * -0.32);
      } else if (profile === 'shoe-box-stack') {
        hand.position.set(0.10 + side * 0.22, -0.43, -0.91);
        hand.rotation.set(-0.26, side * 0.14, side * -0.30);
      } else {
        hand.position.set(0.10 + side * 0.19, -0.39, -0.86);
        hand.rotation.set(-0.26, side * 0.14, side * -0.30);
      }
    }
    carriedBoxHands.visible = true;
  }

  // one shipping-label texture per box id (supplier, order #, weight, category, FRAGILE)
  const shipLabelCache = new Map();
  function boxLabelMat(box, sku) {
    const key = String(box.id);
    let entry = shipLabelCache.get(key);
    if (!entry) {
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 160;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      entry = {
        c: cv.getContext('2d'),
        tex,
        mat: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }),
        sig: '',
      };
      shipLabelCache.set(key, entry);
    }
    const sig = `${box.supplier || ''}|${box.orderId || 0}|${box.skuId}|${box.qty}|${box.lb || ''}|${box.fragile ? 1 : 0}`;
    if (entry.sig === sig) return entry.mat;
    entry.sig = sig;
    const c = entry.c;
    c.clearRect(0, 0, 256, 160);
    c.fillStyle = '#efe7d4'; c.fillRect(0, 0, 256, 160);
    c.strokeStyle = '#b9a074'; c.lineWidth = 4; c.strokeRect(6, 6, 244, 148);
    c.fillStyle = '#1f3a24'; c.font = 'bold 22px Georgia';
    c.fillText((box.supplier || 'FAIRWAY SUPPLY CO.').slice(0, 18), 16, 34);
    c.fillStyle = '#2a2a26'; c.font = '16px Georgia';
    c.fillText(`ORDER #${String(box.orderId || 0).padStart(4, '0')}`, 16, 60);
    c.fillText(`${(sku ? sku.name : box.skuId).slice(0, 20)}`, 16, 82);
    c.fillText(`QTY ${box.qty}    ${box.lb != null ? box.lb + ' LB' : ''}`, 16, 104);
    const glyph = { balls: '●', clubs: 'T', apparel: '▧', accessories: '◆', supplies: '⚙', decor: '❖' }[sku ? sku.cat : 'accessories'] || '◆';
    c.font = 'bold 30px Georgia'; c.fillText(glyph, 214, 44);
    if (box.fragile) {
      c.fillStyle = '#a12a1e'; c.font = 'bold 20px Georgia';
      c.fillText('! FRAGILE', 16, 138);
    }
    entry.tex.needsUpdate = true;
    return entry.mat;
  }

  // a few of the actual product, sitting in the open carton — capped so a big case is a layer, not
  // five hundred meshes. This is what makes "see physical contents" and "partial contents" real.
  function contentsInBox(box, w, h, d) {
    const g = new THREE.Group();
    const sku = SHOP_CATALOG.find((s) => s.id === box.skuId);
    const cat = sku ? sku.cat : 'accessories';
    const show = Math.min(box.qty, 8);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(CAT_COLORS[cat] || 0xb08d57), roughness: 0.7 });
    mat.userData.deliveryOwned = true;
    for (let i = 0; i < show; i++) {
      const item = cat === 'balls'
        ? new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), mats.merchWhite)
        : new THREE.Mesh(new THREE.BoxGeometry(w * 0.22, h * 0.3, d * 0.22), mat);
      const col = i % 3;
      const row = Math.floor(i / 3);
      item.position.set(-w * 0.28 + col * (w * 0.28), h * 0.42 + (i >= 6 ? 0.03 : 0), -d * 0.24 + row * (d * 0.24));
      g.add(item);
    }
    return g;
  }

  // A driver does not arrive in a glove box: the carton is sized from what is inside it, and its
  // seams and flaps show exactly what the sim says the box is doing right now.
  function makeBoxMesh(box) {
    const g = new THREE.Group();
    g.userData.deliveryDisposeAllGeometries = true;
    const { w, h, d } = boxDims(box.box || 'carton');
    const sku = SHOP_CATALOG.find((s) => s.id === box.skuId);

    if (box.flat) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d * 1.6), cardboardDark);
      slab.position.y = 0.015;
      slab.castShadow = true;
      g.add(slab);
      return g;
    }

    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cardboard);
    body.position.y = h / 2;
    body.castShadow = true;
    g.add(body);

    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(w * 0.8, 0.5), Math.min(h * 0.7, 0.32)),
      boxLabelMat(box, sku),
    );
    label.position.set(0, h * 0.55, d / 2 + 0.002);
    g.add(label);

    if (!tapeCut(box)) {
      // tape down the centre seam — recedes from the front as the cut runs (box.tape 0..1)
      const cut = box.tape || 0;
      const remain = 1 - Math.min(1, cut / 0.6);   // the centre seam is the first 60% of the cut
      if (remain > 0.02) {
        const tape = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, 0.012, d * remain), tapeMat);
        tape.position.set(0, h + 0.006, -d / 2 + (d * remain) / 2);
        g.add(tape);
      }
      if (cut < 1) {
        for (const sx of [-w * 0.32, w * 0.32]) {   // the two cross tapes, until the very end
          const cross = new THREE.Mesh(new THREE.BoxGeometry(w * 0.16, 0.012, d + 0.01), tapeMat);
          cross.position.set(sx, h + 0.006, 0);
          g.add(cross);
        }
      }
    } else {
      // two flaps, pivoting up-and-out on box.flaps[0..1] (0 shut .. 1 open)
      const flapGeo = new THREE.BoxGeometry(w * 0.98, 0.012, d * 0.5);
      const fl = box.flaps || [0, 0];
      for (const [i, sign] of [[0, -1], [1, 1]]) {
        const a = (fl[i] || 0) * (Math.PI * 0.62);
        const flap = new THREE.Group();
        const panel = new THREE.Mesh(flapGeo, cardboardDark);
        panel.position.z = sign * d * 0.25;
        flap.add(panel);
        flap.position.set(0, h, sign * d * 0.5);
        flap.rotation.x = sign * -a;
        g.add(flap);
      }
      if (flapsOpen(box) && box.qty > 0) g.add(contentsInBox(box, w, h, d));
      const insideMat = new THREE.MeshStandardMaterial({ color: isEmpty(box) ? 0x241a10 : 0x4a3a28, roughness: 1 });
      insideMat.userData.deliveryOwned = true;
      const inside = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.9, d * 0.9),
        insideMat,
      );
      inside.rotation.x = -Math.PI / 2;
      inside.position.y = h * 0.35;
      g.add(inside);
    }
    return g;
  }

  // Refs 41/42/43/45 are loaded through the same merchandise cache but keep
  // their authored pivots at runtime. The reference is assigned after the box
  // helpers are initialized and before the first boot rebuild.
  let deliveryEquipment = null;
  const deliveryArrivalHandles = new Set();
  const deliveryArrivalPresentations = new Map();
  const registeredDeliveryEquipmentIds = new Set();
  const deliveryEquipmentColliders = [];
  const deliveryVanColliders = new Map();
  const deliveryVanColliderDescriptors = new Map();
  let deliveryVanColliderRevision = -1;

  function boxPlacementRuntime() {
    return {
      center,
      floorY,
      deliveryPadSurfaceY: Number.isFinite(deliveryPadSurfaceY)
        ? deliveryPadSurfaceY : floorY,
      coupledPalletIndex: DELIVERY_PALLET_JACK_COUPLED_INDEX,
      coupledPalletLiftOffset: coupledDeliveryPalletLiftOffset,
      equipmentSocketPose: (equipmentId, socketId) => (
        deliveryEquipment?.socketWorldPose(equipmentId, socketId) || null
      ),
    };
  }

  function placementOccluderIsVisible(object) {
    if (!object?.isMesh || !object.geometry) return false;
    for (let node = object; node; node = node.parent) {
      if (!node.visible) return false;
      if (node === carriedBoxMesh || node === carriedGoodsMesh
        || node === boxPlacementMode?.root) return false;
      // Existing delivery cartons are simulation-owned placement blockers, not
      // opaque scene architecture. Let the analytic floor/support hit through
      // so previewBoxPlacement can render its exact red overlap envelope. Wall,
      // shelf-side, counter, bin, pallet, and equipment meshes remain physical
      // ray occluders; only the boxGroup subtree defers to the conserved-box
      // overlap authority.
      if (node === boxGroup) return false;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    return materials.some((material) => material && material.visible !== false
      && (!material.transparent || Number(material.opacity) > 0.02));
  }

  function sampleNearestPlacementOccluder(origin, direction) {
    placementOcclusionChecks += 1;
    placementOcclusionRaycaster.near = 0.05;
    placementOcclusionRaycaster.far = 3.30;
    placementOcclusionRaycaster.set(origin, direction);
    placementOcclusionHits.length = 0;
    placementOcclusionRoots.length = 0;
    placementOcclusionRoots.push(group, interior, boxGroup);
    if (deliveryPalletStage) placementOcclusionRoots.push(deliveryPalletStage);
    if (deliveryEquipment?.exteriorRoot) {
      placementOcclusionRoots.push(deliveryEquipment.exteriorRoot);
    }
    // One bounded scene query per active placement frame. Surface planes stay
    // cheap analytic tests; this query only supplies the nearest physical
    // blocker so a later plane cannot be selected through a wall, shelf side,
    // bin, or an existing carton.
    placementOcclusionRaycaster.intersectObjects(
      placementOcclusionRoots,
      true,
      placementOcclusionHits,
    );
    const hit = placementOcclusionHits.find((candidate) => (
      Number.isFinite(candidate.distance) && placementOccluderIsVisible(candidate.object)
    ));
    placementOccluderDistance = hit?.distance ?? null;
    placementOccluderName = hit?.object?.name || null;
    return placementOccluderDistance;
  }

  function placementSurfacesForCarriedBox(box) {
    const selectedEquipmentSurfaces = new Set();
    for (const [equipmentId, fallbackSocketId] of [
      [STOCKING_CART_EQUIPMENT_ID, 'STOCK_BOX_SOCKET_TOP'],
      [HAND_TRUCK_EQUIPMENT_ID, 'LOAD_ORIGIN'],
    ]) {
      const query = deliveryEquipmentPlacementForCarriedBox(state, box.id, equipmentId);
      const socketId = query.ok ? query.socketId : fallbackSocketId;
      // Equipment surfaces are renderer-authored: the simulation can know a
      // logical socket before its GLB and named node have mounted. Do not show
      // the static coordinate-adapter fallback in that warm-up window because
      // the later authoritative commit resolves the live socket and could land
      // somewhere other than the preview.
      const livePose = deliveryEquipment?.socketWorldPose(equipmentId, socketId);
      if (livePose?.object
        && livePose.position?.toArray().every(Number.isFinite)
        && livePose.quaternion?.toArray().every(Number.isFinite)) {
        selectedEquipmentSurfaces.add(deliveryEquipmentSurfaceId(equipmentId, socketId));
      }
    }
    return boxPlacementSurfaces(state, { includeUnavailable: false }).filter((surface) => (
      surface.capabilities?.placeBox
      && (surface.kind !== 'equipment-socket' || selectedEquipmentSurfaces.has(surface.id))
    ));
  }

  function placementTargetForHit(surface, hit, rotationY) {
    if (surface.kind === 'equipment-socket') {
      return {
        kind: 'equipment',
        equipmentId: surface.equipmentId,
        socketId: surface.socketId,
      };
    }
    if (surface.kind === 'pallet') {
      return { kind: 'pallet', palletIndex: surface.palletIndex };
    }
    return snapBoxPlacementTarget(state, {
      kind: 'surface',
      surfaceId: surface.id,
      x: hit.localPoint.x,
      z: hit.localPoint.z,
      ry: rotationY,
    });
  }

  function fallbackPlacementPose(surface, hit, target, rotationY) {
    const plane = hit?.plane || surfaceWorldPlane(surface, boxPlacementRuntime());
    if (!plane) return null;
    const localX = target?.kind === 'surface' && Number.isFinite(target.x) ? target.x : 0;
    const localZ = target?.kind === 'surface' && Number.isFinite(target.z) ? target.z : 0;
    const cosine = Math.cos(plane.ry);
    const sine = Math.sin(plane.ry);
    return {
      x: plane.x + cosine * localX + sine * localZ,
      y: plane.y,
      z: plane.z - sine * localX + cosine * localZ,
      ry: plane.ry + (target?.kind === 'surface' ? target.ry : rotationY),
    };
  }

  boxPlacementMode = createBoxPlacementMode({
    parent: scene,
    enumerateSurfaces: ({ box }) => placementSurfacesForCarriedBox(box),
    raycastSurface: (surface, ray) => {
      const hit = raycastBoxPlacementSurface(surface, ray, boxPlacementRuntime());
      if (!hit) return null;
      if (Number.isFinite(placementOccluderDistance)
        && hit.distance > placementOccluderDistance + PLACEMENT_OCCLUSION_TOLERANCE) {
        return null;
      }
      return hit;
    },
    previewPlacement: ({ box, surface, hit, rotationY }) => {
      const target = placementTargetForHit(surface, hit, rotationY);
      const preview = previewBoxPlacement(state, box, target);
      const pose = placementPreviewWorldPose(
        preview,
        surface,
        boxPlacementRuntime(),
      ) || fallbackPlacementPose(surface, hit, target, rotationY);
      return { ...preview, pose };
    },
    commitPlacement: (target, { box }) => putDownBox(state, box.id, target),
  });

  function boxSignature() {
    const d = state.shop.deliveries;
    if (!d) return '';
    const c = state.shop.carry;
    return d.boxes.map((b) => `${b.id}:${b.loc}:${b.surfaceId || ''}:${b.x || 0}:${b.z || 0}:${b.ry || 0}:${b.equipmentId || ''}:${b.socketId || ''}:${b.padPalletIndex ?? ''}:${b.padStagingOverflow ? 1 : 0}:${b.tape || 0}:${(b.flapProgress || b.flaps || [0, 0, 0, 0]).join(',')}:${b.qty}:${b.flat ? 1 : 0}:${b.flattenProgress || 0}:${b.lifecycle || ''}`).join(',')
      + '|' + (c ? c.skuId + c.qty : '') + '|' + d.trash;
  }

  const inStockroomBounds = (lx, lz) => lx >= STOCKROOM.bounds.minX && lx <= STOCKROOM.bounds.maxX
    && lz >= STOCKROOM.bounds.minZ && lz <= STOCKROOM.bounds.maxZ;

  const sfx = (name) => { if (hooks.sfx) hooks.sfx(name); };
  const say = (msg, tone) => { if (hooks.toast) hooks.toast(msg, tone); };

  // put an armful onto the fixture it belongs on (or say why not) — the fixture props call this.
  // Placement is VISIBLE: each unit flies from the player's arms onto the exact
  // slot it will occupy and clicks into place; the shelf bakes when the last
  // one lands (see stockFlights below).
  function stockFromHands(fixtureId, units) {
    const held = carriedGoods(state);
    const before = held && state.shop.inventory[held.skuId]
      ? state.shop.inventory[held.skuId].shelf : 0;
    const res = stockFixture(state, fixtureId, units);
    if (res.ok) {
      const placed = held && state.shop.inventory[held.skuId]
        ? state.shop.inventory[held.skuId].shelf - before : 0;
      if (!(placed > 0 && beginStockFlight(held.skuId, before, placed))) {
        rebuildStock();   // no flight possible: land it the classic way
      }
      rebuildBoxes();       // the arms emptied by that much
      tutorialFlag(state, 'shelved');
    }
    return res;
  }
  B.stockFromHands = stockFromHands;
  B.carriedGoods = () => carriedGoods(state);
  B.rebuildCarry = () => rebuildBoxes();

  // --- stock flights: the hang-it-up animation --------------------------------
  // A stocked unit doesn't teleport onto the display: it leaves the player's
  // arms, arcs to its slot, and CLICKS into the exact pose the shelf will bake
  // it at (same makeStockItem, same slot, same fixture anchor — so the landing
  // is pixel-identical to the final placement). The real shelf redraw is
  // deferred until the last flight lands; any external redraw clears them.
  const stockFlights = [];

  function beginStockFlight(skuId, startIndex, count) {
    const fixture = homeFixture(skuId);
    const anchor = fixture && fixtureAnchors.get(fixture.id);
    const sku = SHOP_CATALOG.find((s) => s.id === skuId);
    if (!anchor || !sku) return false;
    const slots = slotsFor(skuId)
      .map((slot) => resolveAuthoredFixtureSlot(anchor, slot))
      .slice(startIndex, startIndex + count);
    if (!slots.length) return false;

    const ghost = new THREE.Group();
    ghost.position.copy(anchor.position);
    ghost.rotation.copy(anchor.rotation);
    ghost.visible = !hiddenFixtureStock.has(fixture.id);
    stockGroup.add(ghost);
    ghost.updateMatrixWorld(true);

    // launch point: where the armful renders, just below the camera's nose
    const hand = new THREE.Vector3(0.1, -0.35, -0.6).applyMatrix4(camera.matrixWorld);
    const handLocal = ghost.worldToLocal(hand.clone());

    slots.forEach((slot, k) => {
      const item = makeStockItem(sku, slot, startIndex + k);
      if (!item) return;
      const carrier = new THREE.Group();
      carrier.add(item);
      ghost.add(carrier);
      const offset = new THREE.Vector3(
        handLocal.x - slot.x,
        handLocal.y - slot.y,
        handLocal.z - slot.z,
      );
      carrier.position.copy(offset);
      carrier.rotation.set(0.25, 0.4, 0.1);
      stockFlights.push({
        carrier, ghost, offset, fixtureId: fixture.id,
        t: -k * 0.07,             // a stagger, so an armful lands as a patter
        duration: 0.45,
      });
    });
    if (!ghost.children.length) { stockGroup.remove(ghost); return false; }
    // Animated stock is added below the already-mounted stockGroup.
    suppressInteriorSunShadows(ghost);
    return true;
  }

  function clearStockFlights() {
    const ghosts = new Set(stockFlights.map((f) => f.ghost));
    for (const g of ghosts) {
      stockGroup.remove(g);
      ownedStockResources.dispose(g);
    }
    stockFlights.length = 0;
  }

  function updateStockFlights(dt) {
    if (!stockFlights.length) return;
    let landedAll = true;
    for (const f of stockFlights) {
      f.t = Math.min(f.duration, f.t + dt);
      if (f.t < f.duration) landedAll = false;
      const linear = Math.max(0, f.t) / f.duration;
      const eased = linear * linear * (3 - 2 * linear);
      f.carrier.position.set(
        f.offset.x * (1 - eased),
        f.offset.y * (1 - eased) + Math.sin(linear * Math.PI) * 0.22,
        f.offset.z * (1 - eased),
      );
      f.carrier.rotation.set(0.25 * (1 - eased), 0.4 * (1 - eased), 0.1 * (1 - eased));
      // the "click": a whisker of overshoot right before it seats
      const pop = linear > 0.82 ? 1 + 0.08 * Math.sin(((linear - 0.82) / 0.18) * Math.PI) : 1;
      f.carrier.scale.setScalar(pop);
    }
    if (landedAll) {
      if (hooks.sfx) hooks.sfx('stock');
      rebuildStock();          // bakes the real shelf; also clears the ghosts
    }
  }

  function proceduralBoxSignature(box) {
    return `${box.id}|${box.box}|${box.tape || 0}|${(box.flaps || []).join(',')}|${box.qty}|${box.flat ? 1 : 0}`;
  }

  function disposeProceduralDelivery(root) {
    if (!root) return;
    if (root.userData.deliveryOwnedResources) root.userData.deliveryOwnedResources.dispose(root);
    root.traverse((object) => {
      if (object.geometry && root.userData.deliveryDisposeAllGeometries) object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material && material.userData && material.userData.deliveryOwned) material.dispose();
      }
    });
    root.removeFromParent();
  }

  function createBoxView(box) {
    const sku = SHOP_CATALOG.find((candidate) => candidate.id === box.skuId);
    if (canBuildDeliveryBoxVisual(box, merch)) {
      const authored = createDeliveryBoxVisual({ box, sku, merch, mats });
      if (authored) return authored;
    }
    const root = makeBoxMesh(box);
    root.name = `DeliveryBoxFallback_${box.id}`;
    return {
      root,
      authored: false,
      visualSignature: proceduralBoxSignature(box),
      update() {},
      dispose() { disposeProceduralDelivery(root); },
    };
  }

  function removeBoxView(id, removeLabel = false) {
    if (removeLabel) {
      boxOpeningAnimations.delete(id);
      boxOpeningPhases.delete(id);
      boxFlattenAnimations.delete(id);
    }
    const view = boxViews.get(id);
    if (view) {
      view.dispose();
      boxViews.delete(id);
    }
    if (removeLabel) {
      const entry = shipLabelCache.get(String(id));
      if (entry) {
        entry.tex.dispose();
        entry.mat.dispose();
        shipLabelCache.delete(String(id));
      }
    }
  }

  function ensureBoxView(box) {
    let view = boxViews.get(box.id);
    const authoredAvailable = canBuildDeliveryBoxVisual(box, merch);
    const staleFallback = view && !view.authored
      && (authoredAvailable || view.visualSignature !== proceduralBoxSignature(box));
    if (!view || staleFallback) {
      const previous = view && {
        parent: view.root.parent,
        position: view.root.position.clone(),
        rotation: view.root.rotation.clone(),
        scale: view.root.scale.clone(),
      };
      if (view) removeBoxView(box.id, false);
      view = createBoxView(box);
      boxViews.set(box.id, view);
      if (previous && previous.parent) {
        previous.parent.add(view.root);
        view.root.position.copy(previous.position);
        view.root.rotation.copy(previous.rotation);
        view.root.scale.copy(previous.scale);
      }
    }
    view.update(box);
    return view;
  }

  function refreshBoxVisual(id) {
    const box = boxesOf(state).find((candidate) => candidate.id === id);
    if (!box) return;
    const view = boxViews.get(id);
    if (!view || !view.authored) {
      rebuildBoxes();
      return;
    }
    view.update(box);
    boxSig = boxSignature();
  }

  function updateBoxLifecycleAnimations(dt) {
    for (const id of [...boxOpeningAnimations]) {
      const box = boxesOf(state).find((candidate) => candidate.id === id);
      if (!box || box.flat || flapsOpen(box)) {
        boxOpeningAnimations.delete(id);
        boxOpeningPhases.delete(id);
        continue;
      }
      const result = openFlap(state, id, dt * 1.55);
      if (!result.ok) {
        boxOpeningAnimations.delete(id);
        boxOpeningPhases.delete(id);
        continue;
      }
      const priorPhase = boxOpeningPhases.get(id);
      if (priorPhase != null && priorPhase !== result.flap) sfx('flap');
      boxOpeningPhases.set(id, result.flap);
      refreshBoxVisual(id);
      if (result.done) {
        boxOpeningAnimations.delete(id);
        boxOpeningPhases.delete(id);
      }
    }
    for (const id of [...boxFlattenAnimations]) {
      const box = boxesOf(state).find((candidate) => candidate.id === id);
      if (!box || box.flat) {
        boxFlattenAnimations.delete(id);
        continue;
      }
      const result = flattenBox(state, id, dt * 1.35);
      if (!result.ok) {
        boxFlattenAnimations.delete(id);
        continue;
      }
      refreshBoxVisual(id);
      if (result.done) {
        boxFlattenAnimations.delete(id);
        say('Flattened carton ready for recycling.');
      }
    }
  }

  function updateRecyclingDrop(dt) {
    if (!recyclingDrop) return;
    const box = boxesOf(state).find((candidate) => candidate.id === recyclingDrop.id);
    if (!box || !box.flat || box.loc !== 'carried') {
      recyclingDrop = null;
      return;
    }
    recyclingDrop.progress = Math.min(1, recyclingDrop.progress + dt / 0.72);
    if (recyclingDrop.progress < 1) return;
    if (recycleCarriedBox(state, box.id).ok) {
      sfx('disposal');
      say('Cardboard recycled.');
    }
    recyclingDrop = null;
    rebuildBoxes();
  }

  function deliveryOrderPending(box) {
    return !!(box && deliveryPendingBoxIds.has(box.id));
  }

  function equipmentBoxPlacement(box) {
    if (!deliveryEquipment || box?.loc !== 'equipment') return null;
    const socket = deliveryEquipment.socketWorldPose(box.equipmentId, box.socketId);
    if (!socket) return null;
    const worldRotation = socket.quaternion.clone();
    const yaw = new THREE.Euler().setFromQuaternion(worldRotation, 'YXZ').y;
    const local = W2L(socket.position.x, socket.position.z);
    return {
      lx: local.x,
      lz: local.z,
      ry: yaw,
      quaternion: worldRotation,
      x: socket.position.x,
      y: socket.position.y,
      z: socket.position.z,
    };
  }

  function sameDeliveryOrder(box, orderId) {
    return box?.orderId != null && orderId != null
      && String(box.orderId) === String(orderId);
  }

  function clearDeliveryBoxPresentationState(root) {
    if (!root) return;
    for (const key of [
      'deliveryPresentationState', 'deliveryCargoSocket', 'deliveryCargoTier',
      'deliveryCargoOrderId', 'deliveryCargoRestProfile', 'deliveryCargoClearanceSafe',
      'deliveryCargoAnchorError', 'deliveryCargoLoadId', 'deliveryCargoPlacementIndex',
      'deliveryTransferProgress', 'deliveryTransferPhase', 'deliveryInteractionEnabled',
    ]) delete root.userData[key];
  }

  function cargoRootLocalPose(box, placement) {
    const dimensions = boxDims(box?.box);
    const quaternion = new THREE.Quaternion(
      placement.localQuaternion.x,
      placement.localQuaternion.y,
      placement.localQuaternion.z,
      placement.localQuaternion.w,
    ).normalize();
    // Delivery visuals use a floor-centred root. The planner describes the
    // oriented AABB centre, so rotate the source centre and subtract it to
    // recover the exact root pose for upright, side-rest and broad-rest cases.
    const rotatedSourceCentre = new THREE.Vector3(0, dimensions.h / 2, 0)
      .applyQuaternion(quaternion);
    const position = new THREE.Vector3(
      placement.localPosition.x,
      placement.localPosition.y,
      placement.localPosition.z,
    ).sub(rotatedSourceCentre);
    return { position, quaternion };
  }

  function mountDeliveryCargoBox(box, placement, loadContext) {
    if (!deliveryEquipment) return null;
    const vanRoot = deliveryEquipment.rootFor('delivery_van');
    const modelRoot = deliveryEquipment.modelRootFor('delivery_van');
    if (!vanRoot || !modelRoot) return null;
    const view = ensureBoxView(box);
    const root = view.root;
    const pose = cargoRootLocalPose(box, placement);
    const authoredLocal = new THREE.Matrix4().compose(
      pose.position, pose.quaternion, new THREE.Vector3(1, 1, 1),
    );
    modelRoot.updateWorldMatrix(true, false);
    const desiredWorld = modelRoot.matrixWorld.clone().multiply(authoredLocal);
    vanRoot.updateWorldMatrix(true, false);
    const local = vanRoot.matrixWorld.clone().invert().multiply(desiredWorld);
    vanRoot.add(root);
    local.decompose(root.position, root.quaternion, root.scale);
    root.visible = true;
    root.userData.deliveryPresentationState = 'van-cargo-pending';
    root.userData.deliveryCargoLoadId = placement.loadId;
    root.userData.deliveryCargoPlacementIndex = placement.placementIndex;
    root.userData.deliveryCargoOrderId = box.orderId;
    root.userData.deliveryCargoRestProfile = placement.restProfile;
    root.userData.deliveryCargoClearanceSafe = placement.withinBounds;
    root.userData.deliveryInteractionEnabled = false;
    root.updateWorldMatrix(true, false);
    root.userData.deliveryCargoAnchorError = root.matrixWorld.elements.reduce(
      (error, value, index) => Math.max(error, Math.abs(value - desiredWorld.elements[index])), 0,
    );
    return { root, placement, loadContext };
  }

  function mountDeliveryCargoLoad(loadContext) {
    if (!loadContext) return new Set();
    const boxById = new Map(boxesOf(state).map((box) => [box.id, box]));
    const mounted = new Set();
    const planned = [];
    for (const placement of loadContext.placements) {
      const box = boxById.get(placement.boxId);
      if (!box) continue;
      const result = mountDeliveryCargoBox(box, placement, loadContext);
      if (result) mounted.add(box.id);
      planned.push(Object.freeze({
        boxId: placement.boxId,
        loadId: placement.loadId,
        loadIndex: placement.loadIndex,
        loadSequence: placement.loadSequence,
        placementIndex: placement.placementIndex,
        orientationId: placement.orientationId,
        restProfile: placement.restProfile,
        localPosition: Object.freeze({ ...placement.localPosition }),
        localQuaternion: Object.freeze({ ...placement.localQuaternion }),
        orientedDimensions: Object.freeze({ ...placement.orientedDimensions }),
        support: Object.freeze({ ...placement.support }),
        clearance: Object.freeze({
          ...placement.clearance,
          faces: Object.freeze({ ...placement.clearance.faces }),
        }),
        mounted: !!result,
        clearanceSafe: placement.withinBounds,
      }));
    }
    deliveryCargoSnapshot = Object.freeze({
      orderId: loadContext.authorityOrderId,
      arrivalId: loadContext.arrivalId,
      loadId: loadContext.loadId,
      loadIndex: loadContext.loadIndex,
      loadCount: loadContext.loadCount,
      planned: Object.freeze(planned),
      overflowBoxIds: Object.freeze([...loadContext.remainingBoxIds]),
    });
    return mounted;
  }

  function deliveryPadTransferTarget(box, padPlans) {
    const plan = padPlans.get(box.id);
    if (!plan) return null;
    const wp = L2W(plan.x, plan.z);
    const gy = Number.isFinite(deliveryPadSurfaceY)
      ? deliveryPadSurfaceY : groundYAt(wp.x, wp.z);
    const surfaceY = gy !== null && gy !== undefined
      ? gy : heightAt(wp.x, wp.z) + 0.02;
    const baseY = surfaceY + (plan.baseY || 0);
    const lift = plan.palletIndex === DELIVERY_PALLET_JACK_COUPLED_INDEX
      ? coupledDeliveryPalletLiftOffset : 0;
    const worldMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(wp.x, baseY + lift, wp.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, plan.ry, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    boxGroup.updateWorldMatrix(true, false);
    const local = boxGroup.matrixWorld.clone().invert().multiply(worldMatrix);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    local.decompose(position, quaternion, scale);
    return {
      position, quaternion, scale,
      baseY: position.y - lift,
      palletIndex: plan.palletIndex,
    };
  }

  function deliveryTransferWaypoints(root, placement, target) {
    const anchor = deliveryEquipment?.nodeWorldPose(
      'delivery_van', DELIVERY_VAN_REAR_LOADING_ANCHOR,
    );
    const modelRoot = deliveryEquipment?.modelRootFor('delivery_van');
    if (!anchor || !modelRoot) return null;
    root.updateWorldMatrix(true, false);
    boxGroup.updateWorldMatrix(true, false);
    modelRoot.updateWorldMatrix(true, false);
    const startWorld = root.getWorldPosition(new THREE.Vector3());
    const modelRotation = modelRoot.getWorldQuaternion(new THREE.Quaternion());
    const rearDirection = new THREE.Vector3(1, 0, 0).applyQuaternion(modelRotation).normalize();
    const lateralDirection = new THREE.Vector3(0, 0, 1).applyQuaternion(modelRotation).normalize();
    const laneOffset = clamp(Number(placement.localPosition.z) || 0, -0.42, 0.42);
    const apertureWorld = anchor.position.clone().addScaledVector(lateralDirection, laneOffset);
    apertureWorld.y = Math.max(apertureWorld.y + 0.06, startWorld.y);
    const outsideWorld = apertureWorld.clone().addScaledVector(rearDirection, 0.88);
    outsideWorld.y = apertureWorld.y + 0.06;
    const targetWorld = boxGroup.localToWorld(target.position.clone());
    const aboveTargetWorld = targetWorld.clone();
    aboveTargetWorld.y += 0.44;
    const asLocal = (world) => boxGroup.worldToLocal(world.clone());
    return Object.freeze({
      mode: 'rear-aperture-piecewise',
      start: asLocal(startWorld),
      aperture: asLocal(apertureWorld),
      outside: asLocal(outsideWorld),
      aboveTarget: asLocal(aboveTargetWorld),
      target: target.position.clone(),
      world: Object.freeze({
        aperture: Object.freeze(apertureWorld.toArray()),
        outside: Object.freeze(outsideWorld.toArray()),
        aboveTarget: Object.freeze(aboveTargetWorld.toArray()),
      }),
    });
  }

  function beginDeliveryBoxTransfers(loadContext) {
    if (!loadContext) return 0;
    const allBoxes = boxesOf(state);
    const loadIds = new Set(loadContext.boxIds);
    const cargoBoxes = allBoxes.filter((box) => box.loc === 'pad' && loadIds.has(box.id));
    if (!cargoBoxes.length) return 0;
    // Reapply the measured load once at the UNLOAD boundary, then reveal only
    // these exact identities. Later numbered trips for the same order remain
    // hidden and cannot become interactive early.
    mountDeliveryCargoLoad(loadContext);
    for (const boxId of loadContext.boxIds) deliveryPendingBoxIds.delete(boxId);
    const padPlans = new Map(planPalletizedPadBoxes(
      allBoxes.filter((box) => box.loc === 'pad' && !deliveryOrderPending(box)),
      {
        palletHeight: scene.getObjectByName('DeliveryPalletStage')?.userData.ready
          ? DELIVERY_PALLET_STAGING.height : 0,
      },
    ).map((plan) => [plan.boxId, plan]));
    let started = 0;
    // Reverse packing order unloads top/light supports before the boxes below.
    const placements = [...loadContext.placements]
      .sort((a, b) => b.placementIndex - a.placementIndex);
    for (const placement of placements) {
      const box = cargoBoxes.find((candidate) => candidate.id === placement.boxId);
      const root = boxViews.get(placement.boxId)?.root;
      const target = box && deliveryPadTransferTarget(box, padPlans);
      if (!box || !root || !target) continue;
      root.updateWorldMatrix(true, false);
      const worldStart = root.getWorldPosition(new THREE.Vector3());
      boxGroup.attach(root);
      root.updateWorldMatrix(true, false);
      const reparentError = root.getWorldPosition(new THREE.Vector3()).distanceTo(worldStart);
      root.userData.deliveryPresentationState = 'unloading-transfer';
      root.userData.deliveryTransferProgress = 0;
      root.userData.deliveryTransferPhase = 'cargo-to-aperture';
      root.userData.deliveryInteractionEnabled = false;
      const existingProp = boxProps.get(box.id);
      if (existingProp) { removeProp(existingProp); boxProps.delete(box.id); }
      const existingCollider = boxCols.get(box.id);
      if (existingCollider) { removeCol(existingCollider.col); boxCols.delete(box.id); }
      const waypoints = deliveryTransferWaypoints(root, placement, target);
      if (!waypoints) continue;
      deliveryBoxTransfers.set(box.id, {
        boxId: box.id,
        orderId: box.orderId,
        loadId: loadContext.loadId,
        loadIndex: loadContext.loadIndex,
        placementIndex: placement.placementIndex,
        orientationId: placement.orientationId,
        root,
        elapsed: -started * DELIVERY_VAN_BOX_TRANSFER_STAGGER,
        duration: DELIVERY_VAN_BOX_TRANSFER_SECONDS,
        startPosition: root.position.clone(),
        startQuaternion: root.quaternion.clone(),
        startScale: root.scale.clone(),
        targetPosition: target.position.clone(),
        targetQuaternion: target.quaternion,
        targetScale: target.scale,
        targetBaseY: target.baseY,
        palletIndex: target.palletIndex,
        waypoints,
        reparentError,
      });
      started += 1;
    }
    deliveryTransferBatch = started > 0 ? {
      loadId: loadContext.loadId,
      loadIndex: loadContext.loadIndex,
      loadCount: loadContext.loadCount,
      expected: started,
      completed: 0,
      elapsed: 0,
      finalMessage: null,
    } : null;
    return started;
  }

  function updateDeliveryBoxTransfers(dt) {
    if (deliveryTransferBatch) {
      deliveryTransferBatch.elapsed += dt;
      // The ordinary toast lifetime is 2.6 s plus its fade. Hold the completion
      // note until the in-progress note has actually cleared instead of stacking
      // two contradictory delivery states in the same player-camera frame.
      if (deliveryTransferBatch.finalMessage && deliveryTransferBatch.elapsed >= 3.05) {
        say(deliveryTransferBatch.finalMessage);
        deliveryTransferBatch = null;
      }
    }
    if (!deliveryBoxTransfers.size) return;
    const current = new Map(boxesOf(state).map((box) => [box.id, box]));
    let rebuild = false;
    for (const [boxId, transfer] of deliveryBoxTransfers) {
      const box = current.get(boxId);
      if (!box || box.loc !== 'pad') {
        deliveryBoxTransfers.delete(boxId);
        rebuild = true;
        continue;
      }
      transfer.elapsed = Math.min(transfer.duration, transfer.elapsed + dt);
      const linear = clamp(transfer.elapsed / transfer.duration, 0, 1);
      const eased = linear * linear * (3 - 2 * linear);
      const lift = transfer.palletIndex === DELIVERY_PALLET_JACK_COUPLED_INDEX
        ? coupledDeliveryPalletLiftOffset : 0;
      transfer.targetPosition.y = transfer.targetBaseY + lift;
      transfer.waypoints.target.copy(transfer.targetPosition);
      transfer.waypoints.aboveTarget.x = transfer.targetPosition.x;
      transfer.waypoints.aboveTarget.z = transfer.targetPosition.z;
      transfer.waypoints.aboveTarget.y = transfer.targetPosition.y + 0.44;
      let phase = 'cargo-to-aperture';
      let segment = 0;
      let from = transfer.waypoints.start;
      let to = transfer.waypoints.aperture;
      if (linear < 0.30) {
        segment = linear / 0.30;
      } else if (linear < 0.52) {
        phase = 'through-aperture';
        segment = (linear - 0.30) / 0.22;
        from = transfer.waypoints.aperture;
        to = transfer.waypoints.outside;
      } else if (linear < 0.84) {
        phase = 'outside-to-pallet';
        segment = (linear - 0.52) / 0.32;
        from = transfer.waypoints.outside;
        to = transfer.waypoints.aboveTarget;
      } else {
        phase = 'pallet-settle';
        segment = (linear - 0.84) / 0.16;
        from = transfer.waypoints.aboveTarget;
        to = transfer.waypoints.target;
      }
      const segmentEased = segment * segment * (3 - 2 * segment);
      transfer.root.position.lerpVectors(from, to, segmentEased);
      if (phase === 'outside-to-pallet') {
        transfer.root.position.y += Math.sin(Math.PI * segmentEased) * 0.20;
      }
      const rotateProgress = clamp((linear - 0.48) / 0.36, 0, 1);
      const rotateEased = rotateProgress * rotateProgress * (3 - 2 * rotateProgress);
      transfer.root.quaternion.slerpQuaternions(
        transfer.startQuaternion, transfer.targetQuaternion, rotateEased,
      );
      transfer.root.scale.lerpVectors(transfer.startScale, transfer.targetScale, eased);
      transfer.root.userData.deliveryTransferProgress = linear;
      transfer.root.userData.deliveryTransferPhase = phase;
      if (linear < 1) continue;
      transfer.root.position.copy(transfer.targetPosition);
      transfer.root.quaternion.copy(transfer.targetQuaternion);
      transfer.root.scale.copy(transfer.targetScale);
      transfer.root.userData.deliveryPresentationState = 'pallet-landed';
      transfer.root.userData.deliveryInteractionEnabled = false;
      deliveryBoxTransfers.delete(boxId);
      deliveryBoxTransferHistory.push(Object.freeze({
        boxId,
        orderId: transfer.orderId,
        loadId: transfer.loadId,
        loadIndex: transfer.loadIndex,
        placementIndex: transfer.placementIndex,
        orientationId: transfer.orientationId,
        pathMode: transfer.waypoints.mode,
        duration: transfer.duration,
        palletIndex: transfer.palletIndex,
        reparentError: transfer.reparentError,
        waypoints: transfer.waypoints.world,
        target: Object.freeze(transfer.targetPosition.toArray()),
      }));
      if (deliveryBoxTransferHistory.length > 64) deliveryBoxTransferHistory.shift();
      if (deliveryTransferBatch?.loadId === transfer.loadId) {
        deliveryTransferBatch.completed += 1;
      }
      rebuild = true;
    }
    if (rebuild) rebuildBoxes();
    if (deliveryTransferBatch && ![...deliveryBoxTransfers.values()]
      .some((transfer) => transfer.loadId === deliveryTransferBatch.loadId)) {
      const { expected, completed, loadIndex, loadCount } = deliveryTransferBatch;
      const trip = loadCount > 1 ? ` (load ${loadIndex + 1} of ${loadCount})` : '';
      if (completed === expected) {
        sfx('boxdown');
        deliveryTransferBatch.finalMessage = `${completed} carton${completed === 1 ? '' : 's'} staged safely on the receiving pallets${trip}.`;
      } else {
        say(`Carton transfer interrupted; ${completed} of ${expected} reached receiving${trip}.`);
        deliveryTransferBatch = null;
      }
    }
  }

  function deliveryBoxPresentationDiagnostics() {
    const cargoIds = new Set(deliveryCargoSnapshot.planned.map((entry) => entry.boxId));
    const pending = boxesOf(state).filter(deliveryOrderPending).map((box) => ({
      boxId: box.id,
      orderId: box.orderId,
      activeCargo: cargoIds.has(box.id)
        && boxViews.get(box.id)?.root?.userData?.deliveryPresentationState === 'van-cargo-pending',
      viewMounted: boxViews.has(box.id),
      interactionEnabled: boxProps.has(box.id),
      colliderEnabled: boxCols.has(box.id),
    }));
    return {
      quantityAuthority: 'state.shop.deliveries.boxes',
      capacity: PAD_CAPACITY,
      cargoPlanner: 'dimension-aware-ref41-volume-v1',
      transferDurationSeconds: DELIVERY_VAN_BOX_TRANSFER_SECONDS,
      cargoOrderId: deliveryCargoSnapshot.orderId,
      cargoArrivalId: deliveryCargoSnapshot.arrivalId,
      cargoLoadId: deliveryCargoSnapshot.loadId,
      cargoLoadIndex: deliveryCargoSnapshot.loadIndex,
      cargoLoadCount: deliveryCargoSnapshot.loadCount,
      pending,
      cargo: deliveryCargoSnapshot.planned.map((entry) => ({
        ...entry,
        state: boxViews.get(entry.boxId)?.root?.userData?.deliveryPresentationState || null,
        interactionEnabled: boxProps.has(entry.boxId),
        colliderEnabled: boxCols.has(entry.boxId),
      })),
      overflowBoxIds: [...deliveryCargoSnapshot.overflowBoxIds],
      transfers: [...deliveryBoxTransfers.values()].map((entry) => ({
        boxId: entry.boxId,
        orderId: entry.orderId,
        loadId: entry.loadId,
        loadIndex: entry.loadIndex,
        placementIndex: entry.placementIndex,
        orientationId: entry.orientationId,
        pathMode: entry.waypoints.mode,
        phase: entry.root.userData.deliveryTransferPhase,
        state: entry.root.userData.deliveryPresentationState,
        progress: clamp(entry.elapsed / entry.duration, 0, 1),
        reparentError: entry.reparentError,
        palletIndex: entry.palletIndex,
        apertureWorld: [...entry.waypoints.world.aperture],
        outsideWorld: [...entry.waypoints.world.outside],
        interactionEnabled: boxProps.has(entry.boxId),
        colliderEnabled: boxCols.has(entry.boxId),
      })),
      recentTransfers: deliveryBoxTransferHistory.map((entry) => ({ ...entry })),
    };
  }

  function rebuildBoxes() {
    const d = state.shop.deliveries;
    carriedBoxMesh = null;
    carriedBoxHands.visible = false;
    carriedBoxHands.position.set(0, 0, 0);
    if (carriedGoodsMesh) {
      camera.remove(carriedGoodsMesh);
      disposeProceduralDelivery(carriedGoodsMesh);
      carriedGoodsMesh = null;
    }

    const cg = carriedGoods(state);
    if (cg) {
      carriedGoodsMesh = makeGoodsMesh(cg, { merch, mats });
      const profile = carriedGoodsMesh.userData.deliveryCarryProfile;
      const pose = carriedGoodsCameraPose(profile);
      carriedGoodsMesh.position.set(...pose.position);
      carriedGoodsMesh.rotation.set(...pose.rotation);
      carriedGoodsMesh.userData.deliveryCarryBaseY = carriedGoodsMesh.position.y;
      setDeliveryCarryOverlay(carriedGoodsMesh, true);
      camera.add(carriedGoodsMesh);
      poseCarriedGoodsHands(profile);
    }

    const seen = new Set();
    const visualSeen = new Set();
    const colSeen = new Set();   // world boxes that hold a live collider this pass
    exposedPadBoxIds = new Set();
    if (d) {
      const activeLoadPending = deliveryActiveLoad?.boxIds.some((boxId) => (
        deliveryPendingBoxIds.has(boxId)
      ));
      const mountedCargoIds = activeLoadPending
        ? mountDeliveryCargoLoad(deliveryActiveLoad) : new Set();
      const padPlanList = planPalletizedPadBoxes(
        d.boxes.filter((box) => box.loc === 'pad' && !deliveryOrderPending(box)),
        { palletHeight: DELIVERY_PALLET_STAGING.height },
      );
      const padPlans = new Map(padPlanList.map((plan) => [plan.boxId, plan]));
      const topByPallet = new Map();
      for (const plan of padPlanList) topByPallet.set(plan.palletIndex, plan.boxId);
      exposedPadBoxIds = new Set(topByPallet.values());
      const stacks = { pad: 0, stock: 0 };
      for (const box of d.boxes) {
        // Pending paid stock is a view of boxes[] mounted into the currently
        // active van only. Queued orders remain hidden; neither pending cargo
        // nor a mid-air transfer receives a walk prop or collision entry.
        if (deliveryOrderPending(box)) {
          if (mountedCargoIds.has(box.id)) visualSeen.add(box.id);
          continue;
        }
        if (deliveryBoxTransfers.has(box.id)) {
          visualSeen.add(box.id);
          continue;
        }
        visualSeen.add(box.id);
        if (box.loc === 'carried') {
          const view = ensureBoxView(box);
          carriedBoxMesh = view.root;
          clearDeliveryBoxPresentationState(carriedBoxMesh);
          carriedBoxMesh.scale.setScalar(1);
          const carryProfile = deliveryBoxCarryProfile(box);
          carriedBoxMesh.userData.deliveryRuntimeCarryProfile = carryProfile.id;
          carriedBoxMesh.position.set(...carryProfile.position);
          carriedBoxMesh.rotation.set(...carryProfile.rotation);
          carriedBoxMesh.userData.deliveryCarryBaseY = carriedBoxMesh.position.y;
          setDeliveryCarryOverlay(carriedBoxMesh, true);
          camera.add(carriedBoxMesh);
          poseCarriedBoxHands(box);
          continue;
        }
        let lx; let lz; let ry;
        let fixedSurfaceY = null;
        let fixedQuaternion = null;
        let resolvedSurfaceId = null;
        if (box.loc === 'world') {
          const resolved = resolveBoxPose(state, box);
          if (resolved.ok) {
            lx = resolved.pose.x;
            lz = resolved.pose.z;
            ry = resolved.pose.ry;
            fixedSurfaceY = floorY + resolved.pose.baseY;
            resolvedSurfaceId = resolved.surfaceId;
          } else {
            // ensureDeliveries heals invalid persisted surfaces to stock. This
            // fallback also keeps a just-corrupted live object visible until
            // that next simulation read, without interpreting local shelf
            // coordinates as a floor position.
            const at = STOCKROOM.receivingInside;
            const i = stacks.stock++;
            const dim = boxDims(box.box || 'carton');
            lx = at.x + (i % 3 - 1) * Math.max(0.62, dim.w + 0.14);
            lz = at.z + Math.floor(i / 3) * Math.max(0.56, dim.d + 0.14) - 0.3;
            ry = 0;
          }
        } else if (box.loc === 'pad') {
          const plan = padPlans.get(box.id);
          if (plan) {
            lx = plan.x; lz = plan.z; ry = plan.ry;
            resolvedSurfaceId = `pallet:receiving:${plan.palletIndex}`;
          } else {
            const at = STOCKROOM.receivingInside;
            lx = at.x; lz = at.z; ry = 0;
          }
        } else if (box.loc === 'equipment') {
          const placement = equipmentBoxPlacement(box);
          if (placement) {
            ({ lx, lz, ry } = placement);
            fixedSurfaceY = placement.y;
            fixedQuaternion = placement.quaternion;
            resolvedSurfaceId = `equipment:${box.equipmentId}:${box.socketId}`;
          } else {
            // A save must remain playable while the async GLB cache warms up or
            // if an optional prop fails to load. Show the same box at receiving;
            // the onReady rebuild snaps it back to its persisted socket.
            const at = STOCKROOM.receivingInside;
            const i = stacks.stock++;
            const dim = boxDims(box.box || 'carton');
            lx = at.x + (i % 3 - 1) * Math.max(0.62, dim.w + 0.14);
            lz = at.z + Math.floor(i / 3) * Math.max(0.56, dim.d + 0.14) - 0.3;
            ry = (box.id % 5) * 0.13;
          }
        } else {
          const at = STOCKROOM.receivingInside;
          const i = stacks.stock++;
          const dim = boxDims(box.box || 'carton');
          lx = at.x + (i % 3 - 1) * Math.max(0.62, dim.w + 0.14);
          lz = at.z + Math.floor(i / 3) * Math.max(0.56, dim.d + 0.14) - 0.3;
          ry = (box.id % 5) * 0.13;
        }
        const wp = L2W(lx, lz);
        const m = ensureBoxView(box).root;
        setDeliveryCarryOverlay(m, false);
        clearDeliveryBoxPresentationState(m);
        const gy = box.loc === 'pad' && Number.isFinite(deliveryPadSurfaceY)
          ? deliveryPadSurfaceY : groundYAt(wp.x, wp.z);
        const padPlan = box.loc === 'pad' ? padPlans.get(box.id) : null;
        const padLift = padPlan?.baseY || 0;
        const boxBaseY = (Number.isFinite(fixedSurfaceY)
          ? fixedSurfaceY
          : (gy !== null && gy !== undefined ? gy : heightAt(wp.x, wp.z) + 0.02)) + padLift;
        const coupledLift = padPlan?.palletIndex === DELIVERY_PALLET_JACK_COUPLED_INDEX
          ? coupledDeliveryPalletLiftOffset : 0;
        m.scale.setScalar(1);
        m.position.set(
          wp.x,
          boxBaseY + coupledLift,
          wp.z,
        );
        if (padPlan?.palletIndex === DELIVERY_PALLET_JACK_COUPLED_INDEX) {
          m.userData.deliveryPalletBaseY = boxBaseY;
          m.userData.deliveryPalletIndex = DELIVERY_PALLET_JACK_COUPLED_INDEX;
        } else {
          delete m.userData.deliveryPalletBaseY;
          delete m.userData.deliveryPalletIndex;
        }
        if (fixedQuaternion) m.quaternion.copy(fixedQuaternion);
        else m.rotation.set(0, ry, 0);
        boxGroup.add(m);

        seen.add(box.id);
        let prop = boxProps.get(box.id);
        if (!prop) { prop = boxPropFor(box.id); boxProps.set(box.id, prop); }
        prop.x = wp.x;
        prop.y = m.position.y;
        prop.aimY = m.position.y + boxPlacementDimensions(box).h / 2;
        prop.z = wp.z;
        prop.lx = lx;
        prop.lz = lz;
        prop.ry = ry;
        prop.surfaceId = resolvedSurfaceId;
        m.userData.deliveryPresentationState = box.loc === 'pad' ? 'pallet-ready' : 'world-ready';
        m.userData.deliveryInteractionEnabled = true;

        // a set-down box occupies the floor: register a collider so the player AND the
        // customer nav grid (which bakes from the same list) both treat it as solid. Only
        // WORLD drops — the ones a player can put anywhere; pad/stock stacks sit at
        // known-clear spots. The sig gate means a hold-to-cut (same spot) never re-bakes nav.
        if (box.loc === 'world' && resolvedSurfaceId === FLOOR_BOX_SURFACE_ID) {
          const cdim = boxDims(box.box || 'carton');
          const cosine = Math.abs(Math.cos(ry));
          const sine = Math.abs(Math.sin(ry));
          const cw = cosine * cdim.w + sine * cdim.d;
          const cd = sine * cdim.w + cosine * cdim.d;
          const csig = `${lx.toFixed(2)},${lz.toFixed(2)},${cw.toFixed(2)},${cd.toFixed(2)}`;
          colSeen.add(box.id);
          const prevc = boxCols.get(box.id);
          if (!prevc || prevc.sig !== csig) {
            if (prevc) removeCol(prevc.col);
            boxCols.set(box.id, { col: addCol(colBoxAt(lx, lz, cw, cd)), sig: csig });
          }
        }
      }
    }
    for (const [id, prop] of [...boxProps]) {
      if (!seen.has(id)) { removeProp(prop); boxProps.delete(id); }
    }
    for (const [id, entry] of [...boxCols]) {
      if (!colSeen.has(id)) { removeCol(entry.col); boxCols.delete(id); }  // picked up, moved, or gone
    }
    for (const id of [...boxViews.keys()]) {
      if (!visualSeen.has(id)) removeBoxView(id, true);
    }
    syncCarriedBoxPlacement();
    boxSig = boxSignature();
  }

  // Saved equipment placement is evaluated from the authored socket every
  // frame. The hand-truck LOAD_ORIGIN sits below its axle pivot, so its carton
  // follows the complete tip-back transform instead of remaining upright while
  // the truck visibly moves through it.
  function syncEquipmentBoxViews() {
    if (!deliveryEquipment) return;
    for (const box of state.shop.deliveries?.boxes || []) {
      if (box.loc !== 'equipment') continue;
      const view = boxViews.get(box.id);
      const placement = equipmentBoxPlacement(box);
      if (!view || !placement) continue;
      view.root.position.set(placement.x, placement.y, placement.z);
      view.root.quaternion.copy(placement.quaternion);
      const prop = boxProps.get(box.id);
      if (prop) {
        prop.x = placement.x;
        prop.y = placement.y;
        prop.aimY = placement.y + boxPlacementDimensions(box).h / 2;
        prop.z = placement.z;
        prop.lx = placement.lx;
        prop.lz = placement.lz;
        prop.ry = placement.ry;
      }
    }
  }

  const placementRayOrigin = new THREE.Vector3();
  const placementRayDirection = new THREE.Vector3();

  function startRecyclingDrop(box = carriedBox(state)) {
    if (!box?.flat || box.loc !== 'carried') return false;
    if (recyclingDrop) return recyclingDrop.id === box.id;
    placementBoxId = box.id;
    placementDismissedBoxId = box.id;
    if (boxPlacementMode?.isActive()) boxPlacementMode.cancel();
    recyclingDrop = { id: box.id, progress: 0 };
    return true;
  }

  function beginCarriedBoxPlacement({ force = false } = {}) {
    const box = carriedBox(state);
    if (!box || !boxPlacementMode || recyclingDrop) return false;
    if (!force && placementDismissedBoxId === box.id) return false;
    if (boxPlacementMode.isActive() && placementBoxId === box.id) return true;
    if (boxPlacementMode.isActive()) boxPlacementMode.cancel();
    placementBoxId = box.id;
    placementDismissedBoxId = null;
    return boxPlacementMode.begin({
      box,
      dimensions: boxPlacementDimensions(box),
      rotationY: 0,
    });
  }

  function syncCarriedBoxPlacement() {
    const box = carriedBox(state);
    if (recyclingDrop) {
      if (boxPlacementMode?.isActive()) boxPlacementMode.cancel();
      placementBoxId = box?.id ?? recyclingDrop.id;
      placementDismissedBoxId = placementBoxId;
      return;
    }
    if (!box) {
      if (boxPlacementMode?.isActive()) boxPlacementMode.cancel();
      placementBoxId = null;
      placementDismissedBoxId = null;
      return;
    }
    if (box.id !== placementBoxId) {
      placementDismissedBoxId = null;
      beginCarriedBoxPlacement({ force: true });
    } else if (!boxPlacementMode.isActive() && placementDismissedBoxId !== box.id) {
      beginCarriedBoxPlacement({ force: true });
    }
  }

  function updateBoxPlacementPreview() {
    if (recyclingDrop) {
      if (boxPlacementMode?.isActive()) boxPlacementMode.cancel();
      return;
    }
    if (!boxPlacementMode?.isActive()) return;
    camera.getWorldPosition(placementRayOrigin);
    camera.getWorldDirection(placementRayDirection);
    sampleNearestPlacementOccluder(placementRayOrigin, placementRayDirection);
    boxPlacementMode.update({
      origin: placementRayOrigin,
      direction: placementRayDirection,
    });
  }

  function commitCarriedBoxPlacement() {
    if (!boxPlacementMode?.isActive()) return false;
    const carried = carriedBox(state);
    const recyclingWorld = L2W(STOCKROOM.bin.x, STOCKROOM.bin.z);
    if (carried?.flat && Math.hypot(
      recyclingWorld.x - walk.x,
      recyclingWorld.z - walk.z,
    ) <= 1.8) {
      startRecyclingDrop(carried);
      return true;
    }
    const result = boxPlacementMode.commit();
    if (result === false || result?.ok === false) {
      const reason = result?.reason || boxPlacementMode.diagnostics().reason;
      if (reason) say(reason, 'warn');
      return true;
    }
    sfx('boxdown');
    rebuildBoxes();
    return true;
  }

  function cancelCarriedBoxPlacement() {
    const box = carriedBox(state);
    if (!box || !boxPlacementMode?.isActive()) return false;
    placementDismissedBoxId = box.id;
    boxPlacementMode.cancel();
    return true;
  }

  function boxPlacementLabel() {
    const box = carriedBox(state);
    if (!box) return null;
    const sku = SHOP_CATALOG.find((entry) => entry.id === box.skuId);
    const name = sku?.name || box.skuId || 'carton';
    const recyclingWorld = L2W(STOCKROOM.bin.x, STOCKROOM.bin.z);
    if (recyclingDrop?.id === box.id) {
      return 'Recycling — lowering the flattened carton in...';
    }
    if (box.flat && Math.hypot(
      recyclingWorld.x - walk.x,
      recyclingWorld.z - walk.z,
    ) <= 1.8) {
      return 'Recycling — [E] drop the flattened carton in';
    }
    if (!boxPlacementMode?.isActive()) {
      return `Carrying ${name} ×${box.qty} — [E] choose a placement`;
    }
    const diagnostics = boxPlacementMode.diagnostics();
    if (!diagnostics.visible) {
      return `Carrying ${name} ×${box.qty} — aim down at an approved surface · [R] rotate`;
    }
    if (!diagnostics.legal) {
      return `${diagnostics.reason || 'That placement is blocked.'} · [R] rotate · [Esc] keep carrying`;
    }
    return `Carrying ${name} ×${box.qty} — [E] place · [R] rotate · [Esc] keep carrying`;
  }

  // a box in the stockroom is unpacked in place; anywhere else, [E] lifts it into your arms
  function unpackHere(prop, b) {
    return boxPlacementCapabilities(state, b).canUnpack;
  }

  function canRepositionClosedCarton(prop, b) {
    if (!b || b.loc === 'carried' || carriedBox(state) || carriedGoods(state)) return false;
    if (b.loc === 'pad' && !exposedPadBoxIds.has(b.id)) return false;
    if (!unpackHere(prop, b) || b.flat || isEmpty(b)) return false;
    if (boxOpeningAnimations.has(b.id) || boxFlattenAnimations.has(b.id)
      || deliveryBoxTransfers.has(b.id) || recyclingDrop?.id === b.id) return false;
    if ((Number(b.openingProgress) || 0) > 0.001
      || (Number(b.flattenProgress) || 0) > 0.001) return false;
    const flaps = Array.isArray(b.flapProgress) ? b.flapProgress : (b.flaps || []);
    if (flaps.some((progress) => (Number(progress) || 0) > 0.001)) return false;
    return !b.lifecycle || ['SEALED', 'CUTTING', 'CUT_COMPLETE'].includes(b.lifecycle);
  }

  // the box's verbs, chosen live from its state. Reused across rebuilds (keyed by id) so a
  // hold-to-cut is never torn down mid-cut.
  function boxPropFor(id) {
    const box = () => boxesOf(state).find((b) => b.id === id);
    let lastCutBeat = -1;
    const pickUp = (b) => {
      const r = pickUpBox(state, b.id);
      if (!r.ok) { say(r.reason, 'warn'); return; }
      sfx('boxup');
      rebuildBoxes();
    };
    const advanceCut = (amount) => {
      const b = box();
      const step = Number(amount);
      if (!b || !unpackHere(prop, b) || b.flat || tapeCut(b) || isEmpty(b)
        || !(step > 0) || !Number.isFinite(step)) return;
      const r = cutTape(state, b.id, step);
      if (r.ok) {
        const cutBeat = Math.floor((Number(b.tape) || 0) * 10);
        if (cutBeat !== lastCutBeat || r.done) {
          lastCutBeat = cutBeat;
          sfx('tapeCut');
        }
        if (r.done) {
          sfx('tapeRelease');
          tutorialFlag(state, 'boxCut');
        }
        refreshBoxVisual(b.id);
      }
    };
    const prop = addProp({
      x: 0, z: 0, r: 1.9,
      // When a carton sits on a cart or hand truck its parent equipment prop
      // occupies almost the same XZ point. The aimed 3D carton receives a
      // modest score advantage, while looking toward the handle still selects
      // the equipment control because the carton's facing score falls away.
      get focusBias() {
        // Equipment cartons need only a tiny tie-breaker against their parent
        // prop now that both use true 3D crosshair scoring. Other cartons get
        // no global distance advantage over nearby doors, bins, or fixtures.
        return box()?.loc === 'equipment' ? 0.08 : 0;
      },
      label: () => {
        const b = box();
        if (!b || b.loc === 'carried' || carriedBox(state)) return null;
        if (b.loc === 'pad' && !exposedPadBoxIds.has(b.id)) return null;
        const sku = SHOP_CATALOG.find((s) => s.id === b.skuId);
        const name = sku ? sku.name : b.skuId;
        if (b.flat) return 'Flattened carton — [E] carry it to the recycling';
        if (isEmpty(b)) return boxFlattenAnimations.has(b.id)
          ? `Folding the empty ${name} carton...`
          : `Empty ${name} box — [E] flatten it`;
        if (!unpackHere(prop, b)) {
          return `${b.loc === 'pad' ? 'Delivery: ' : ''}${name} ×${b.qty}${b.lb ? ` · ${b.lb} lb` : ''} — [E] pick up`;
        }
        if (tapeUncut(b)) return `${name} case · ${b.qty} inside — [LMB] drag along tape · [E] hold alternative`;
        if (!tapeCut(b)) return `${name} — [LMB] drag along tape · [E] hold alternative`;
        if (!flapsOpen(b)) return boxOpeningAnimations.has(b.id)
          ? `${name} — opening all four flaps...`
          : `${name} — [E] open the carton`;
        const held = carriedGoods(state);
        if (held && held.skuId !== b.skuId) return `${name} ×${b.qty}, open — put down what you're holding first`;
        return `${name} ×${b.qty} in the case — [E] take an armful`;
      },
      get tool() {
        const b = box();
        if (!b || carriedBox(state)) return null;
        return unpackHere(prop, b) && !b.flat && !tapeCut(b) && !isEmpty(b) ? 'boxcutter' : null;
      },
      get toolProgress() {
        const b = box();
        return b ? Math.max(0, Math.min(1, Number(b.tape) || 0)) : 0;
      },
      get toolPath() {
        const b = box();
        if (!b) return null;
        const view = boxViews.get(b.id);
        return typeof view?.toolPathAtProgress === 'function'
          ? view.toolPathAtProgress(b.tape)
          : null;
      },
      get secondaryLabel() {
        const b = box();
        return canRepositionClosedCarton(prop, b) ? 'reposition closed carton' : null;
      },
      secondaryAction: () => {
        const b = box();
        if (!canRepositionClosedCarton(prop, b)) return;
        pickUp(b);
      },
      drag: (amount) => advanceCut(amount),
      hold: (dt) => advanceCut(dt * 0.5),
      action: () => {
        const b = box();
        if (!b) return;
        if (b.loc === 'pad' && !exposedPadBoxIds.has(b.id)) return;
        const sku = SHOP_CATALOG.find((s) => s.id === b.skuId);
        const name = sku ? sku.name : b.skuId;
        if (b.flat) { pickUp(b); return; }
        if (isEmpty(b)) {
          if (!boxFlattenAnimations.has(b.id)) {
            boxFlattenAnimations.add(b.id);
            sfx('boxFlatten');
            say('Folding the empty carton flat...');
          }
          return;
        }
        if (!unpackHere(prop, b)) { pickUp(b); return; }
        if (!tapeCut(b)) return;              // cutting is the hold verb; a tap does nothing here
        if (!flapsOpen(b)) {
          if (!boxOpeningAnimations.has(b.id)) {
            boxOpeningAnimations.add(b.id);
            boxOpeningPhases.set(b.id, 0);
            sfx('flap');
          }
          return;
        }
        const r = takeFromBox(state, b.id);
        if (!r.ok) { say(r.reason, 'warn'); return; }
        sfx('itemRemoval');
        tutorialFlag(state, 'boxCarried');
        if (r.left <= 0) say(`${r.taken} × ${name} — the case is empty.`);
        rebuildBoxes();
      },
    });
    return prop;
  }

  function stockingCartPlacementContext(box = carriedBox(state), radius = 1.75) {
    if (!box || !deliveryEquipment) return null;
    const target = deliveryEquipment.nodeWorldPose(
      'delivery_stocking_cart',
      'INTERACTION_TARGET',
    );
    if (!target || Math.hypot(target.position.x - walk.x, target.position.z - walk.z) > radius) {
      return null;
    }
    return {
      target,
      placement: stockingCartPlacementForCarriedBox(state, box.id),
    };
  }

  function placeCarriedBoxOnStockingCart({ requireNearby = true } = {}) {
    const box = carriedBox(state);
    if (!box) return false;
    const context = requireNearby
      ? stockingCartPlacementContext(box)
      : { placement: stockingCartPlacementForCarriedBox(state, box.id) };
    if (!context) return false;
    if (!context.placement.ok) {
      say(context.placement.reason, 'warn');
      return true;
    }
    const result = putDownBox(state, box.id, context.placement.target);
    if (!result.ok) {
      say(result.reason, 'warn');
      return true;
    }
    const sku = SHOP_CATALOG.find((entry) => entry.id === box.skuId);
    sfx('boxdown');
    say(`${sku ? sku.name : 'Carton'} placed securely on the stocking cart.`);
    rebuildBoxes();
    return true;
  }

  function handTruckPlacementContext(box = carriedBox(state), radius = 2.2) {
    if (!box || !deliveryEquipment) return null;
    const target = deliveryEquipment.nodeWorldPose(
      'delivery_hand_truck',
      'INTERACTION_TARGET',
    );
    if (!target || Math.hypot(target.position.x - walk.x, target.position.z - walk.z) > radius) {
      return null;
    }
    return {
      target,
      placement: handTruckPlacementForCarriedBox(state, box.id),
    };
  }

  function placeCarriedBoxOnHandTruck({ requireNearby = true } = {}) {
    const box = carriedBox(state);
    if (!box) return false;
    const context = requireNearby
      ? handTruckPlacementContext(box)
      : { placement: handTruckPlacementForCarriedBox(state, box.id) };
    if (!context) return false;
    if (!context.placement.ok) {
      say(context.placement.reason, 'warn');
      return true;
    }
    const result = putDownBox(state, box.id, context.placement.target);
    if (!result.ok) {
      say(result.reason, 'warn');
      return true;
    }
    const sku = SHOP_CATALOG.find((entry) => entry.id === box.skuId);
    sfx('boxdown');
    say(`${sku ? sku.name : 'Carton'} placed against the hand-truck back.`);
    rebuildBoxes();
    return true;
  }

  const carryProp = addProp({
    x: 0, z: 0, r: 2.5,
    label: () => {
      const cb = carriedBox(state);
      if (cb) return boxPlacementLabel();
      const cg = carriedGoods(state);
      if (cg) {
        const sku = SHOP_CATALOG.find((s) => s.id === cg.skuId);
        const l = W2L(walk.x, walk.z);
        if (inStockroomBounds(l.x, l.z)) {
          const fixture = homeFixture(cg.skuId);
          const units = cg.qty === 1 ? 'this unit' : 'these units';
          return `Holding ${sku.name} ×${cg.qty} — [E] store ${units} in back · sales floor: ${fixture?.title || 'assigned display'}`;
        }
        // Outside the stockroom, let the real shelf fixture own the prompt.
        // This helper follows 0.9 m ahead and otherwise always wins nearest-
        // focus selection, preventing the player from physically stocking.
        return null;
      }
      return null;
    },
    action: () => {
      const cb = carriedBox(state);
      if (cb) {
        if (boxPlacementMode?.isActive()) commitCarriedBoxPlacement();
        else beginCarriedBoxPlacement({ force: true });
        return;
      }
      const cg = carriedGoods(state);
      if (cg) {
        const l = W2L(walk.x, walk.z);
        if (inStockroomBounds(l.x, l.z)) {
          const r = storeInBack(state);
          if (r.ok) {
            sfx('product');
            say(`${r.moved} × ${SHOP_CATALOG.find((s) => s.id === cg.skuId).name} on the backroom shelf.`);
            rebuildStock();
            rebuildBoxes();
          }
        } else {
          say('Carry these to the right fixture and hold [E], or take them to the backroom.', 'warn');
        }
      }
    },
  });

  // the recycling bin by the stock door
  {
    const wp = L2W(STOCKROOM.bin.x, STOCKROOM.bin.z);
    addProp({
      x: wp.x, z: wp.z, r: 1.8,
      label: () => {
        const cb = carriedBox(state);
        if (recyclingDrop) return 'Recycling — lowering the flattened carton in...';
        if (cb && cb.flat) return 'Recycling — [E] drop the flattened carton in';
        const dd = state.shop.deliveries;
        const flatNear = dd && dd.boxes.some((b) => b.flat && b.loc !== 'carried');
        return flatNear || (dd && dd.trash > 0) ? 'Recycling — [E] break down the flattened cartons' : null;
      },
      action: () => {
        const cb = carriedBox(state);
        if (cb && cb.flat) {
          startRecyclingDrop(cb);
          return;
        }
        if (emptyTrash(state).ok) { sfx('disposal'); say('Cardboard recycled — the stockroom breathes again.'); rebuildBoxes(); }
      },
    });
  }

  function mutableEquipmentCollider(descriptor) {
    return {
      minX: descriptor.minX,
      maxX: descriptor.maxX,
      minZ: descriptor.minZ,
      maxZ: descriptor.maxZ,
      minY: descriptor.minY,
      maxY: descriptor.maxY,
      kind: 'delivery-equipment',
      equipmentId: descriptor.equipmentId,
      name: descriptor.name,
    };
  }

  function syncColliderFromDescriptor(collider, descriptor) {
    collider.minX = descriptor.minX;
    collider.maxX = descriptor.maxX;
    collider.minZ = descriptor.minZ;
    collider.maxZ = descriptor.maxZ;
    collider.minY = descriptor.minY;
    collider.maxY = descriptor.maxY;
  }

  function syncStaticDeliveryColliders(equipmentId) {
    if (!deliveryEquipment) return;
    const current = deliveryEquipment.colliderDescriptorMap(equipmentId);
    for (const collider of deliveryEquipmentColliders) {
      if (collider.equipmentId !== equipmentId) continue;
      const descriptor = current.get(collider.name);
      if (descriptor) syncColliderFromDescriptor(collider, descriptor);
    }
  }

  function coupleDeliveryPalletJack() {
    if (!deliveryEquipment || !coupledDeliveryPalletAssetRoot
      || !Number.isFinite(deliveryPadSurfaceY)) return null;
    const result = deliveryEquipment.couplePalletJackToPallet({
      palletRoot: coupledDeliveryPalletAssetRoot,
      palletIndex: DELIVERY_PALLET_JACK_COUPLED_INDEX,
      surfaceY: deliveryPadSurfaceY,
    });
    if (result?.ok && deliveryPalletStage) {
      deliveryPalletStage.userData.palletJackCoupled = true;
      deliveryPalletStage.userData.channelAlignmentDot = result.channelAlignmentDot;
      deliveryPalletStage.userData.socketHorizontalError = result.socketHorizontalError;
    }
    return result;
  }

  function syncCoupledDeliveryPalletLift() {
    if (!deliveryEquipment || !coupledDeliveryPalletAnchor
      || !Number.isFinite(deliveryPadSurfaceY)) return false;
    const measured = Number(deliveryEquipment.palletJackLiftOffset?.());
    const liftOffset = Number.isFinite(measured) ? measured : 0;
    coupledDeliveryPalletLiftOffset = liftOffset;
    coupledDeliveryPalletAnchor.position.y = deliveryPadSurfaceY + liftOffset;
    if (coupledDeliveryPalletCollider) {
      coupledDeliveryPalletCollider.minY = deliveryPadSurfaceY + liftOffset;
      coupledDeliveryPalletCollider.maxY = coupledDeliveryPalletCollider.minY
        + DELIVERY_PALLET_STAGING.height;
    }
    const coupledBoxIds = [];
    for (const box of boxesOf(state)) {
      if (box.loc !== 'pad'
        || box.padPalletIndex !== DELIVERY_PALLET_JACK_COUPLED_INDEX
        || deliveryOrderPending(box)) continue;
      const view = boxViews.get(box.id);
      const base = Number(view?.root?.userData?.deliveryPalletBaseY);
      if (view?.root && Number.isFinite(base)) {
        view.root.position.y = base + liftOffset;
        const prop = boxProps.get(box.id);
        if (prop) {
          prop.y = view.root.position.y;
          prop.aimY = view.root.position.y + boxPlacementDimensions(box).h / 2;
        }
      }
      coupledBoxIds.push(box.id);
    }
    if (deliveryPalletStage) {
      deliveryPalletStage.userData.liftOffset = liftOffset;
      deliveryPalletStage.userData.coupledBoxIds = coupledBoxIds;
      deliveryPalletStage.userData.coupledVisualY = coupledDeliveryPalletAnchor.position.y;
      deliveryPalletStage.userData.coupledColliderMinY = coupledDeliveryPalletCollider?.minY ?? null;
      deliveryPalletStage.userData.coupledColliderMaxY = coupledDeliveryPalletCollider?.maxY ?? null;
    }
    return true;
  }

  function deliveryPalletCouplingDiagnostics() {
    const runtime = deliveryEquipment?.diagnostics?.().palletJack?.coupling || null;
    if (!runtime && !coupledDeliveryPalletAnchor) return null;
    const control = deliveryPalletStage?.getObjectByName('DeliveryPallet_1') || null;
    return {
      ...runtime,
      coupledPalletIndex: DELIVERY_PALLET_JACK_COUPLED_INDEX,
      baseY: deliveryPadSurfaceY,
      visualY: coupledDeliveryPalletAnchor?.position.y ?? null,
      controlPalletIndex: 0,
      controlVisualY: control?.position.y ?? null,
      colliderMinY: coupledDeliveryPalletCollider?.minY ?? null,
      colliderMaxY: coupledDeliveryPalletCollider?.maxY ?? null,
      liftOffset: coupledDeliveryPalletLiftOffset,
      coupledBoxIds: boxesOf(state).filter((box) => (
        box.loc === 'pad' && box.padPalletIndex === DELIVERY_PALLET_JACK_COUPLED_INDEX
      )).map((box) => box.id),
    };
  }

  function clearDeliveryVanColliders() {
    for (const collider of deliveryVanColliders.values()) removeCol(collider);
    deliveryVanColliders.clear();
    deliveryVanColliderDescriptors.clear();
    deliveryVanColliderRevision = -1;
  }

  function installDeliveryVanColliders({ closedCargo = false } = {}) {
    clearDeliveryVanColliders();
    if (!deliveryEquipment) return;
    const descriptors = deliveryEquipment.colliderDescriptors('delivery_van');
    for (const descriptor of descriptors) {
      // Player collision is currently 2D. Register the vertical shell here;
      // the raised load-floor footprint is represented once below as an honest
      // non-walkable platform until a deployable ramp/dynamic floor exists.
      if (descriptor.name === 'COL_VAN_CARGO_FLOOR'
        || descriptor.name === 'COL_VAN_CARGO_ROOF') continue;
      const collider = mutableEquipmentCollider(descriptor);
      addCol(collider);
      deliveryVanColliders.set(descriptor.name, collider);
      deliveryVanColliderDescriptors.set(descriptor.name, descriptor);
    }
    // The authored floor is about 0.50 m above grade. Removing its 2D footprint
    // when the doors opened let a normal-W player walk underneath/intersect it
    // at turf height. Reuse that exact footprint in every phase: closed it is
    // the cargo hull; open it is the raised platform's safety boundary.
    const cargoFootprint = descriptors.find((entry) => entry.name === 'COL_VAN_CARGO_FLOOR');
    if (cargoFootprint) {
      const hull = mutableEquipmentCollider(cargoFootprint);
      hull.name = closedCargo
        ? 'COL_VAN_CLOSED_CARGO_HULL'
        : 'COL_VAN_OPEN_CARGO_PLATFORM_HULL';
      addCol(hull);
      deliveryVanColliders.set(hull.name, hull);
      deliveryVanColliderDescriptors.set(hull.name, cargoFootprint);
    }
    deliveryVanColliderRevision = deliveryEquipment.colliderRevision('delivery_van');
  }

  function syncDeliveryVanColliders() {
    if (!deliveryEquipment || !deliveryVanColliders.size) return;
    const revision = deliveryEquipment.colliderRevision('delivery_van');
    if (revision === deliveryVanColliderRevision) return;
    // Refreshes the stable descriptor objects only when the wrapper or an
    // authored cargo-door pivot has actually moved.
    deliveryEquipment.colliderDescriptors('delivery_van');
    for (const [name, collider] of deliveryVanColliders) {
      const descriptor = deliveryVanColliderDescriptors.get(name);
      if (descriptor) syncColliderFromDescriptor(collider, descriptor);
    }
    deliveryVanColliderRevision = revision;
  }

  function deliveryEquipmentProp(entry, x, z, y = null) {
    // These are full-size wheeled props with collision shells; their handles
    // must become focusable before the player's capsule is stopped by the
    // frame/forks. Keep the reach restrained but outside each footprint.
    const interactionRadius = {
      delivery_hand_truck: 2.20,
      delivery_stocking_cart: 2.05,
      delivery_pallet_jack: 1.90,
    }[entry.id] || 1.8;
    const liveFocusPoint = { x, y: Number.isFinite(y) ? y : floorY, z };
    const focusPoint = () => {
      const node = entry.interactionTarget;
      if (!node?.parent) return liveFocusPoint;
      node.updateWorldMatrix(true, false);
      const elements = node.matrixWorld.elements;
      liveFocusPoint.x = elements[12];
      liveFocusPoint.y = elements[13];
      liveFocusPoint.z = elements[14];
      return liveFocusPoint;
    };
    const common = {
      x, z, r: interactionRadius,
      aimY: liveFocusPoint.y,
      focusPoint,
    };
    if (entry.id === 'delivery_hand_truck') {
      return addProp({
        ...common,
        retainFocus: () => !!deliveryEquipment?.diagnostics().handTruck.active,
        label: () => {
          const status = deliveryEquipment?.diagnostics().handTruck;
          if (status?.active) return 'Delivery hand truck — checking the axle balance...';
          const box = carriedBox(state);
          if (box) {
            const placement = handTruckPlacementForCarriedBox(state, box.id);
            return placement.ok
              ? 'Delivery hand truck — [E] place the carton on the toe plate'
              : `Delivery hand truck — ${placement.reason}`;
          }
          return 'Delivery hand truck — [E] tip it back and check the load balance';
        },
        action: () => {
          if (deliveryEquipment?.diagnostics().handTruck.active) return;
          if (carriedBox(state)) {
            placeCarriedBoxOnHandTruck({ requireNearby: false });
            return;
          }
          const started = deliveryEquipment?.triggerHandTruckTilt?.();
          if (started === false) return;
          sfx('thunk');
          equipmentColliderSyncSeconds = 1.6;
        },
      });
    }
    if (entry.id === 'delivery_stocking_cart') {
      return addProp({
        ...common,
        label: () => {
          const box = carriedBox(state);
          if (box) {
            const placement = stockingCartPlacementForCarriedBox(state, box.id);
            return placement.ok
              ? 'Stocking cart — [E] place the carton on the top deck'
              : `Stocking cart — ${placement.reason}`;
          }
          const occupied = boxesOf(state).filter((boxEntry) => (
            boxEntry.loc === 'equipment'
            && boxEntry.equipmentId === 'delivery_stocking_cart'
          )).length;
          return occupied
            ? `Stocking cart — ${occupied} saved carton position${occupied === 1 ? '' : 's'} in use`
            : 'Stocking cart — top deck ready for a delivery carton';
        },
        action: () => {
          if (carriedBox(state)) {
            placeCarriedBoxOnStockingCart({ requireNearby: false });
          } else {
            say('Bring a compatible carton here to stage it on the cart.');
          }
        },
      });
    }
    return addProp({
      ...common,
      label: () => {
        const status = deliveryEquipment?.diagnostics().palletJack;
        if (status?.active) return 'Pallet jack — hydraulic stroke in progress...';
        return status?.raised
          ? 'Pallet jack — [E] pump once to lower the forks'
          : 'Pallet jack — [E] pump once to raise the forks';
      },
      action: () => {
        const started = deliveryEquipment?.triggerPalletJackPump?.();
        if (started === false) return;
        sfx('thunk');
        equipmentColliderSyncSeconds = 2.2;
      },
    });
  }

  function registerDeliveryEquipmentAssets() {
    if (!deliveryEquipment) return;
    coupleDeliveryPalletJack();
    for (const entry of deliveryEquipment.staticPropRoots()) {
      if (!entry.modelRoot || registeredDeliveryEquipmentIds.has(entry.id)) continue;
      // Interior contents never enter the course sun-shadow atlas. These models
      // arrive below an already-mounted empty wrapper, so enforce that invariant
      // again after the asynchronous clone is attached.
      if (entry.zone === 'interior') {
        entry.root.traverse((object) => { if (object.isMesh) object.castShadow = false; });
      }
      for (const descriptor of entry.colliders) {
        const collider = addCol(mutableEquipmentCollider(descriptor));
        deliveryEquipmentColliders.push(collider);
      }
      entry.root.updateWorldMatrix(true, true);
      const target = entry.interactionTarget
        ? entry.interactionTarget.getWorldPosition(new THREE.Vector3())
        : entry.root.getWorldPosition(new THREE.Vector3());
      deliveryEquipmentProp(entry, target.x, target.z, target.y);
      registeredDeliveryEquipmentIds.add(entry.id);
    }
    rebuildBoxes();
  }

  function handleDeliveryEquipmentBeat(beat, event) {
    const loadContext = deliveryLoadPlansByArrivalId.get(event?.id) || null;
    if (beat === DELIVERY_VAN_BEATS.QUEUED) {
      // Multiple orders may enter the authoritative pad collection in one sim
      // tick. Hide each newly queued order immediately; only activeArrival is
      // allowed to occupy the one visible van below.
      rebuildBoxes();
    } else if (beat === DELIVERY_VAN_BEATS.APPROACH) {
      // The van is solid for its whole visible route; every frame below keeps
      // these mutable bounds synchronized with the authored moving proxies.
      installDeliveryVanColliders({ closedCargo: true });
      deliveryActiveLoad = loadContext;
      sfx('truck');
      rebuildBoxes();
    } else if (beat === DELIVERY_VAN_BEATS.PARKED) {
      installDeliveryVanColliders({ closedCargo: true });
    } else if (beat === DELIVERY_VAN_BEATS.CARGO_OPEN) {
      // Once the doors finish opening, swap the closed-volume hull for the
      // authored cab/wall/pillar shell so both cargo approaches are genuinely
      // navigable instead of being sealed by a horizontal proxy.
      installDeliveryVanColliders({ closedCargo: false });
      sfx('doorSwing');
    } else if (beat === DELIVERY_VAN_BEATS.UNLOAD) {
      const count = loadContext?.boxIds.length || 0;
      const started = beginDeliveryBoxTransfers(loadContext);
      const trip = loadContext?.loadCount > 1
        ? ` (load ${loadContext.loadIndex + 1} of ${loadContext.loadCount})` : '';
      say(`Unloading ${started || count} carton${(started || count) === 1 ? '' : 's'}${trip}.`);
    } else if (beat === DELIVERY_VAN_BEATS.DOORS_CLOSING) {
      sfx('doorShut');
    } else if (beat === DELIVERY_VAN_BEATS.DEPARTING) {
      // The doors have reached their exact closed pose before this beat. The
      // course walk recovery will depenetrate anyone still in the footprint,
      // then the synchronized hull pushes safely along the departure route.
      installDeliveryVanColliders({ closedCargo: true });
    } else if (beat === DELIVERY_VAN_BEATS.COMPLETE) {
      clearDeliveryVanColliders();
      if (deliveryActiveLoad?.arrivalId === event?.id) deliveryActiveLoad = null;
      if (event?.id) deliveryLoadPlansByArrivalId.delete(event.id);
    }
  }

  function presentDeliveryArrival(payload = {}) {
    if (!deliveryEquipment) return false;
    const orderId = payload.orderId;
    const authorityOrderId = orderId == null ? null : String(orderId);
    const presentationKey = authorityOrderId ?? `anonymous-${Date.now()}`;
    const existing = deliveryArrivalPresentations.get(presentationKey);
    if (existing) return existing;
    const cargoBoxes = boxesOf(state).filter((box) => (
      box.loc === 'pad' && sameDeliveryOrder(box, orderId)
    ));
    if (!cargoBoxes.length) return false;
    const cargoPlan = planDeliveryVanCargo(cargoBoxes);
    const allBoxIds = cargoPlan.placements.map((entry) => entry.boxId);
    for (const boxId of allBoxIds) deliveryPendingBoxIds.add(boxId);
    const handles = [];
    for (const load of cargoPlan.loads) {
      const suffix = cargoPlan.loadCount > 1
        ? `-load-${String(load.loadSequence).padStart(2, '0')}` : '';
      const arrivalId = authorityOrderId == null
        ? `delivery-arrival-${load.loadId}`
        : `delivery-order-${authorityOrderId}${suffix}`;
      const remainingBoxIds = cargoPlan.loads
        .slice(load.loadIndex + 1).flatMap((entry) => entry.boxIds);
      const loadContext = Object.freeze({
        arrivalId,
        authorityOrderId,
        loadId: load.loadId,
        loadIndex: load.loadIndex,
        loadCount: cargoPlan.loadCount,
        boxIds: Object.freeze([...load.boxIds]),
        remainingBoxIds: Object.freeze(remainingBoxIds),
        placements: Object.freeze([...load.placements]),
        diagnostics: Object.freeze({ ...load.diagnostics }),
      });
      deliveryLoadPlansByArrivalId.set(arrivalId, loadContext);
      const handle = deliveryEquipment.presentArrival({
        id: arrivalId,
        orderId,
        payload: {
          ...payload,
          boxCount: load.boxIds.length,
          deliveryLoadId: load.loadId,
          deliveryLoadIndex: load.loadIndex,
          deliveryLoadCount: cargoPlan.loadCount,
          boxIds: [...load.boxIds],
        },
      });
      if (!handle) {
        deliveryLoadPlansByArrivalId.delete(arrivalId);
        for (const boxId of load.boxIds) deliveryPendingBoxIds.delete(boxId);
        continue;
      }
      handles.push(handle);
      deliveryArrivalHandles.add(handle);
      handle.promise.then((result) => {
        deliveryArrivalHandles.delete(handle);
        deliveryLoadPlansByArrivalId.delete(arrivalId);
        if (result?.status === 'cancelled') {
          for (const boxId of loadContext.boxIds) deliveryPendingBoxIds.delete(boxId);
          if (deliveryActiveLoad?.arrivalId === arrivalId) deliveryActiveLoad = null;
          if (deliveryEquipment) rebuildBoxes();
        }
      });
    }
    if (!handles.length) {
      for (const boxId of allBoxIds) deliveryPendingBoxIds.delete(boxId);
      return false;
    }
    let returned = handles[0];
    if (handles.length > 1) {
      const promise = Promise.all(handles.map((handle) => handle.promise)).then((results) => Object.freeze({
        id: `delivery-order-${authorityOrderId}`,
        orderId: authorityOrderId,
        loadCount: handles.length,
        status: results.every((result) => result.status === 'completed') ? 'completed' : 'cancelled',
        unloaded: results.every((result) => result.unloaded !== false),
        results: Object.freeze(results),
      }));
      returned = Object.freeze({
        id: `delivery-order-${authorityOrderId}`,
        orderId: authorityOrderId,
        loadCount: handles.length,
        promise,
        get status() {
          if (handles.every((handle) => handle.status === 'completed')) return 'completed';
          if (handles.some((handle) => handle.status === 'active')) return 'active';
          return handles.every((handle) => handle.status === 'cancelled') ? 'cancelled' : 'queued';
        },
        cancel: (reason = 'cancelled') => handles.reduce(
          (cancelled, handle) => (handle.cancel(reason) ? cancelled + 1 : cancelled), 0,
        ),
      });
    }
    deliveryArrivalPresentations.set(presentationKey, returned);
    return returned;
  }

  let equipmentColliderSyncSeconds = 0;
  function deliveryVanContactSurfaceY(x, z) {
    const terrainY = heightAt(x, z);
    if (!deliveryVanBayBounds || !Number.isFinite(deliveryVanBaySurfaceY)) return terrainY;
    const inside = Math.min(
      x - deliveryVanBayBounds.minX,
      deliveryVanBayBounds.maxX - x,
      z - deliveryVanBayBounds.minZ,
      deliveryVanBayBounds.maxZ - z,
    );
    if (inside <= 0) return terrainY;
    const blend = clamp(inside / deliveryVanBayBounds.blend, 0, 1);
    return THREE.MathUtils.lerp(terrainY, deliveryVanBaySurfaceY, blend);
  }

  function deliveryEquipmentGroundY(x, z, equipmentId) {
    if (equipmentId === 'delivery_pallet_jack' && Number.isFinite(deliveryPadSurfaceY)) {
      return deliveryPadSurfaceY;
    }
    if (equipmentId !== 'delivery_van') return heightAt(x, z);
    // Ref 41's fixed -90-degree parking orientation puts its four authored
    // wheel contacts at world ±0.91 X and ±1.72 Z from the wrapper. Ground the
    // body from all four patches instead of the centre point so the approach
    // cannot bury one axle while another reaches the flat service slab.
    const contacts = [];
    for (const dx of [-0.91, 0.91]) {
      for (const dz of [-1.72, 1.72]) {
        const sample = deliveryVanContactSurfaceY(x + dx, z + dz);
        if (Number.isFinite(sample)) contacts.push(sample);
      }
    }
    if (!contacts.length) return heightAt(x, z);
    return contacts.reduce((sum, value) => sum + value, 0) / contacts.length;
  }

  deliveryEquipment = createDeliveryEquipment({
    merch,
    parents: { interior, exterior: scene },
    localToWorld: (x, z) => L2W(x, z),
    groundYAt: deliveryEquipmentGroundY,
    onBeat: handleDeliveryEquipmentBeat,
    onUnload: () => rebuildBoxes(),
    onError: (_error, detail) => say(`Delivery presentation recovered from ${detail.label}.`, 'warn'),
  });
  deliveryEquipment.onReady(registerDeliveryEquipmentAssets);
  // createDeliveryEquipment registers its loader callback first. This callback
  // therefore sees the final mounted/missing set and can fail open: a bad van
  // must never leave already-paid boxes hidden forever.
  merch.onReady(() => {
    registerDeliveryEquipmentAssets();
    if (deliveryEquipment.missingAssets().includes('delivery_van')) {
      for (const handle of [...deliveryArrivalHandles]) handle.cancel('delivery-van-unavailable');
      sfx('truck');
      say('The van could not be shown, but the paid delivery was placed safely on receiving.', 'warn');
      rebuildBoxes();
    }
  });

  // --- customers: they walk in from the course, through the real door -------------------
  let unitSeq = 0;   // every unit a shopper lifts gets its own identity
  const customers = [];
  let disposing = false;
  let disposalSummary = null;
  // golfer-wardrobe palette, muted to the club color language
  const CUST_COLORS = [0x4a6d94, 0x2c3e66, 0xb0788f, 0x8f4f39, 0x4a7050, 0x7b8277, 0x4d4038];
  const counterQueue = [];
  const doorW = L2W(DOOR_MAIN.x, halfD);
  const spawnW = { x: doorW.x + 1.5, z: doorW.z + SHELL.porchD + 9 };

  function queueSlotW(i) {
    const s = queueSlot(i);
    return L2W(s.x, s.z);
  }

  function spawnCustomer(toCounter = false, reservation = null, options = {}) {
    // Keep the existing boolean call surface used by organic shoppers and QA,
    // while allowing a due tee-time record to supply stable presentation identity.
    // Accepting the record as the first argument is a convenience for future
    // callers and remains backward-compatible with debugSpawn(true/false).
    if (toCounter && typeof toCounter === 'object') {
      reservation = toCounter;
      toCounter = true;
    }
    const reservationId = reservation && reservation.id != null ? reservation.id : null;
    let identity = reservation && reservation.customerId
      ? customerIdentityById(state, reservation.customerId)
      : null;
    if (!identity) {
      identity = allocateCustomerIdentity(state, reservationId != null ? {
        sourceId: `reservation:${reservationId}`,
        legacy: {
          customerId: reservation.customerId,
          name: reservation.fullName || reservation.name,
          paymentPreference: reservation.paymentPreference,
          personality: reservation.personality,
          patience: reservation.patience,
          punctuality: reservation.punctuality,
          travelDistance: reservation.travelDistance,
          parkingSensitivity: reservation.parkingSensitivity,
          weatherSensitivity: reservation.weatherSensitivity,
          loungePreference: reservation.loungePreference,
        },
      } : {});
    }
    if (reservation && reservation.customerId !== identity.customerId) {
      reservation.customerId = identity.customerId;
      reservation.name = identity.fullName;
      reservation.fullName = identity.fullName;
      reservation.paymentPreference ||= identity.paymentPreference;
    }
    const walkInRequest = !toCounter
      && options.allowWalkInRequest === true
      && identity.visitProfile.preferredPurpose === 'tee-time'
      && ['friendly', 'exacting'].includes(identity.personality);
    const customerType = reservationId != null
      ? (reservation.customerType || 'reservation')
      : walkInRequest ? 'walk-in-tee' : 'retail';
    const rng = rngOf(state);
    // real variety on the floor: builds, trousers, skin tones, hats or hair
    const TROUSERS = [0xc2b190, 0x8a8577, 0x4b545c, 0x6b5a44];
    const SKINS = [0xd9a97e, 0xb9865e, 0x8a5f42, 0xe8c39a];
    let poloIndex = rng.int(CUST_COLORS.length);
    const previousPolo = customers.length
      ? customers[customers.length - 1].presentationPolo
      : null;
    if (CUST_COLORS[poloIndex] === previousPolo) {
      poloIndex = (poloIndex + 1) % CUST_COLORS.length;
    }
    const presentationPolo = CUST_COLORS[poloIndex];
    const char = makeCharacter({
      polo: presentationPolo,
      khaki: TROUSERS[rng.int(TROUSERS.length)],
      skin: SKINS[rng.int(SKINS.length)],
      cap: rng.chance(0.55) ? (rng.chance(0.5) ? 0xf2efe4 : 0x2c3e66) : null,
    });
    char.root.scale.setScalar(0.87 + rng.next() * 0.12);
    char.setMode('Walk');
    char.root.userData.char = char;
    const g = char.root;
    g.position.set(spawnW.x + (rng.next() - 0.5) * 3, heightAt(spawnW.x, spawnW.z), spawnW.z + rng.next() * 2);
    custGroup.add(g);

    const stops = [];
    let organicPlan = { target: 0, picks: [] };
    // the approach: porch step, then just inside the door (the doorbell moment)
    stops.push({ kind: 'walk', x: doorW.x, z: doorW.z + 2.6 });
    stops.push({ kind: 'enter', x: doorW.x, z: doorW.z - 1.4 });
    if (!toCounter && !walkInRequest) {
      const browsable = placedFixtures(state).filter((f) => f.skus && f.skus.length > 0);
      // Plan one real fixture visit per intended unit, preferring different
      // displays before revisiting a well-stocked one.
      organicPlan = planOrganicOrder(browsable, state.shop.inventory, rng);
      const visits = organicPlan.picks.length
        ? organicPlan.picks
        : (browsable.length ? [{ fixture: browsable[rng.int(browsable.length)], skuId: null }] : []);
      for (const visit of visits) {
        const f = visit.fixture;
        // Keep a stable fixture-local browse pose so a customer already en
        // route follows the same display through a build-mode move or turn.
        const fixtureLocalX = (rng.next() - 0.5) * 0.8;
        const halfDepth = Number.isFinite(f.footprint?.maxZ)
          ? f.footprint.maxZ
          : (FIXTURE_HALF[f.kind] || [1, 1])[1];
        const fixtureLocalZ = halfDepth + 0.72 + (rng.next() - 0.5) * 0.4;
        const pose = fixtureBrowsePose(f, fixtureLocalX, fixtureLocalZ);
        stops.push({
          kind: 'fixture',
          fixtureId: f.id,
          fixtureLocalX,
          fixtureLocalZ,
          skus: f.skus,
          plannedSku: visit.skuId,
          browseOnly: !visit.skuId,
          title: f.title,
          ...pose,
        });
      }
    }
    // Paying visitors draw their cash-or-card preference ONCE here, from the
    // balanced shuffled bag (sim/paymentBag.js). Reservation guests already drew
    // at booking time; pure browsers who will never reach the counter don't draw
    // at all, so the bag's 50/50 guarantee is spent only on real payers.
    const paysAtCounter = toCounter || walkInRequest || organicPlan.picks.length > 0;
    const bagMethod = !reservation && paysAtCounter
      ? drawPaymentMethod(state, () => rng.next())
      : null;
    const assignedPayment = reservation?.paymentPreference || bagMethod || identity.paymentPreference;
    const deskReadyAt = reservationId != null
      ? Number(reservation.deskReadyAt ?? (Number(reservation.teeTimeAbs) - 15))
      : null;
    const loungeEarly = reservationId != null
      && Number.isFinite(deskReadyAt)
      && state.clock.minutes < deskReadyAt;
    if (loungeEarly) {
      // Keep the early-arrival hold on the open entrance side of the lounge.
      // The old back-corner point routed directly through chair B whenever the
      // nav solver fell back to an exact target, pinning reservation guests.
      const lounge = L2W(2.8, -4.0);
      stops.push({
        kind: 'lounge',
        x: lounge.x,
        z: lounge.z,
        faceX: L2W(LOUNGE.coffee.x, LOUNGE.coffee.z).x,
        faceZ: L2W(LOUNGE.coffee.x, LOUNGE.coffee.z).z,
      });
    }
    if (toCounter || walkInRequest || organicPlan.picks.length) {
      const regW = L2W(COUNTER.registerX, COUNTER.z);
      stops.push({ kind: 'counter', x: queueSlotW(0).x, z: queueSlotW(0).z, faceX: regW.x, faceZ: regW.z });
    }
    stops.push({ kind: 'exit', x: doorW.x, z: doorW.z + 2.6 });
    stops.push({ kind: 'gone', x: spawnW.x, z: spawnW.z });

    customers.push({
      mesh: g,
      identity,
      customerId: identity.customerId,
      fullName: identity.fullName,
      name: identity.fullName,
      presentationPolo,
      paymentPreference: assignedPayment,
      payMethod: assignedPayment,
      paymentDialogue: paymentChoiceDialogue({
        ...identity,
        paymentPreference: assignedPayment,
      }),
      personality: identity.personality,
      customerType,
      partySize: reservation?.partySize || identity.visitProfile.usualPartySize || 1,
      reservationId,
      groupMembers: reservation?.groupMembers ? [...reservation.groupMembers] : [],
      teeTime: reservation?.minute ?? null,
      arrivalTime: reservation?.arrivalTime ?? (reservationId != null ? state.clock.minutes : null),
      paymentStatus: reservation?.paymentStatus || 'pending',
      reservationStatus: reservation?.status || null,
      checkInStatus: reservation?.checkInStatus || null,
      reviewPersonality: reservation?.reviewPersonality || identity.personality,
      reservationReleased: false,
      reservationExitReason: null,
      stops,
      stopIdx: 0,
      linger: loungeEarly ? 5 + identity.patience * 5 : (toCounter ? 0 : 2 + rng.next() * 4),
      speed: toCounter ? 1.15 : 1.1 + rng.next() * 0.5,
      queued: false,
      rangBell: false,
      cart: [],
      targetCartSize: organicPlan.target,
      scanned: 0,
      patience: PATIENCE_FULL,   // the 3-minute register clock; browsing never drains it
      awaitingCheckout: false,
      itemMeshes: new Map(),
      checkoutProductResources: createRegisterItemResources(),
      oversizeCarryRoot: null,
      checkoutPhase: organicPlan.target
        ? 'shopping'
        : (reservationId != null
          ? (loungeEarly ? 'reservation-arriving' : 'reservation-arriving')
          : walkInRequest ? 'walk-in-arriving' : 'browsing'),
      currentDestination: loungeEarly ? 'lounge' : (toCounter || walkInRequest ? 'front-desk' : 'shop'),
      loungeUntil: loungeEarly ? deskReadyAt : null,
      deskGreetingSpoken: false,
      dialogue: '',
      checkoutPlacedCount: 0,
      checkoutPlacement: null,
      checkoutFlow: organicPlan.target ? createCheckoutFlow({ nowMs: flowNow() }) : null,
      checkoutApproachArmed: false,
      // what a review will be written from: did they get in, did they buy, did they wait
      seed: rng.next(),
      entered: false,
      bought: false,
      reviewed: false,
      queuedAt: 0,
      queueLenOnArrival: 0,
      isGolfer: toCounter, // the ones with a tee time actually played the course
      bagMesh: null,
      bagCarryRoot: null,
      bagCarryTarget: null,
      checkoutHandoffBag: null,
      handoffReceipt: null,
      bagAcceptanceHold: 0,
      bagAcceptanceFace: null,
      bagAcceptanceYaw: null,
      impatientBeat: null,
      giveUpHandled: false,
      reachedRegHead: false,   // the 3-minute register clock arms here, never while browsing
      visitRecorded: false,
    });
    return customers[customers.length - 1];
  }

  // HOW LONG THEY HAVE BEEN WAITING, shown RESTRAINEDLY — the brief's word. A red bar
  // over a shopper's head in a stylised pro shop is a mobile-game tell. This is a thin
  // ring that fills as their patience burns down, and it only appears once they have
  // actually been kept waiting — early goodwill costs them nothing, so nothing is
  // drawn. It goes amber at half and red at a quarter, which is the point at which
  // a player who is paying attention still has time to save the sale.
  //
  // THE CLOCK ONLY RUNS AT THE REGISTER. A shopper browsing the floor never
  // "gives up" — the TEN-minute wait starts when they reach the counter head
  // with their goods and stand unserved, and the price of blowing it is a bad
  // review, not a mystery walk-out.
  const PATIENCE_FULL = 600;
  const PATIENCE_SEGMENTS = 24;
  const PATIENCE_INDICES_PER_SEGMENT = 6;
  const patRing = new THREE.RingGeometry(0.10, 0.125, PATIENCE_SEGMENTS, 1, Math.PI / 2, -Math.PI * 2);
  function setPatience(c) {
    const frac = clamp(c.patience / PATIENCE_FULL, 0, 1);
    if (frac > 0.72) {                       // still fresh — do not nag
      if (c.patienceMesh) c.patienceMesh.visible = false;
      return;
    }
    if (!c.patienceMesh) {
      const m = new THREE.Mesh(patRing.clone(), new THREE.MeshBasicMaterial({
        color: 0xf2c14e, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
      }));
      m.position.set(0, 1.62, 0);
      m.renderOrder = 3;
      c.mesh.add(m);
      c.patienceMesh = m;
    }
    const m = c.patienceMesh;
    m.visible = true;
    // The ring empties clockwise as patience runs out. A fixed indexed ring plus
    // drawRange preserves the 24-step readout without rebuilding GPU geometry
    // every frame (including frames where an active cashier freezes patience).
    const visibleSegments = Math.ceil(frac * PATIENCE_SEGMENTS);
    const indexCount = visibleSegments * PATIENCE_INDICES_PER_SEGMENT;
    if (m.geometry.drawRange.count !== indexCount) m.geometry.setDrawRange(0, indexCount);
    m.material.color.setHex(frac < 0.25 ? 0xe8635a : frac < 0.5 ? 0xf2a03d : 0xf2c14e);
    m.material.opacity = 0.55 + (1 - frac) * 0.35;
    // it always faces the player, so it reads from anywhere on the floor
    if (walk.active) m.rotation.y = Math.atan2(walk.x - c.mesh.position.x, walk.z - c.mesh.position.z) - c.mesh.rotation.y;
  }

  // a shopper reaches for the display: the unit leaves the shelf THERE and
  // rides in their hands to the register
  // Carry proxies share their expensive parts. There can be up to four per shopper,
  // so creating new geometry and materials for every visit would turn a normal queue
  // into needless draw-state churn.
  function disposeCustomerProductMesh(c, mesh) {
    if (!mesh) return;
    mesh.removeFromParent();
    if (c.checkoutProductResources) c.checkoutProductResources.dispose(mesh);
  }

  function makeCustomerItemMesh(c, item) {
    const sku = SHOP_CATALOG.find((s) => s.id === item.skuId);
    const built = buildCatalogProductProxy({
      sku,
      merch,
      mats,
      resources: c.checkoutProductResources,
    });
    const group = built.root;
    group.userData.checkoutUid = item.uid;
    group.userData.catalogKind = built.descriptor.kind;
    group.userData.gripMode = built.descriptor.gripMode;
    group.userData.separateHandoff = built.descriptor.separateHandoff;
    return group;
  }

  function layoutCustomerCarry(c) {
    const carried = (c.cart || []).filter((item) => {
      const mesh = c.itemMeshes && c.itemMeshes.get(item.uid);
      return mesh && mesh.parent === c.mesh;
    });
    let compactIndex = 0;
    let oversizeIndex = 0;
    carried.forEach((item) => {
      const mesh = c.itemMeshes.get(item.uid);
      const sku = SHOP_CATALOG.find((entry) => entry.id === item.skuId);
      const descriptor = catalogProductVisual(sku);
      if (descriptor.separateHandoff) {
        // Long goods ride vertically against the customer's side until their
        // authored placement motion lowers them flat onto the counter.
        const side = oversizeIndex++ % 2;
        mesh.position.set(0.28 + side * 0.12, 1.12, 0.10 - side * 0.08);
        mesh.rotation.set(0, -0.12 + side * 0.20, Math.PI / 2);
        return;
      }
      const side = compactIndex % 2;
      const tier = Math.floor(compactIndex / 2);
      compactIndex++;
      mesh.position.set(0.11 + side * 0.15, 0.63 + tier * 0.13, 0.13 - side * 0.025);
      mesh.rotation.set(-0.10 + tier * 0.05, -0.22 + side * 0.40, side ? -0.08 : 0.08);
    });
  }

  function syncCustomerItemMeshes(c) {
    reconcileCustomerItemMeshes(c, {
      create: (item) => makeCustomerItemMesh(c, item),
      attach: (mesh) => c.mesh.add(mesh),
      detach: (mesh) => disposeCustomerProductMesh(c, mesh),
    });
    layoutCustomerCarry(c);
    return c.itemMeshes;
  }

  function clearCustomerItemMeshes(c) {
    if (c.itemMeshes) {
      for (const mesh of c.itemMeshes.values()) disposeCustomerProductMesh(c, mesh);
      c.itemMeshes.clear();
    }
    c.checkoutPlacement = null;
    c.placeMotion = null;
    if (register && typeof register.setPlacementPreview === 'function') register.setPlacementPreview(null);
  }

  function updateCustomerPlacement(c, dt) {
    if (!c.checkoutPlacement) {
      syncCustomerItemMeshes(c);
      c.checkoutPlacement = createSequentialPlacement(c.cart);
      c.checkoutPlacedCount = 0;
      c.checkoutPhase = 'placing';
      if (!c.checkoutFlow) c.checkoutFlow = createCheckoutFlow({ nowMs: flowNow() });
      if (c.checkoutFlow.state === 'CustomerApproaching') {
        advanceCustomerCheckout(c, 'CustomerPlacingProducts', 'customer-reached-checkout-marker');
      }
      if (register.setPlacementPreview) register.setPlacementPreview(c);
    }

    const event = stepSequentialPlacement(c.checkoutPlacement, dt);
    if (event.started) {
      const index = c.cart.findIndex((item) => item.uid === event.started);
      const item = c.cart[index];
      const mesh = c.itemMeshes.get(event.started);
      const poses = catalogCheckoutLayout(
        c.cart.map((entry) => ({ sku: SHOP_CATALOG.find((sku) => sku.id === entry.skuId) })),
        REGISTER.staging,
        COUNTER_TOP + 0.012,
      );
      const pose = poses[index];
      item.placed = false;
      item.placedAt = pose;
      if (mesh) {
        const char = c.mesh.userData.char;
        let wristStart = null;
        if (char && char.hand) {
          char.setMode('Checkout');
          char.update(0);
          c.mesh.updateMatrixWorld(true);
          wristStart = char.hand(index % 2 ? 'L' : 'R').getWorldPosition(new THREE.Vector3());
          interior.worldToLocal(wristStart);
        }
        // Preserve the hand's world pose while changing ownership to the counter.
        interior.attach(mesh);
        if (wristStart) mesh.position.copy(wristStart);
        c.placeMotion = {
          uid: item.uid,
          from: mesh.position.clone(),
          fromRotation: mesh.rotation.clone(),
          pose,
        };
      }
      if (register.setPlacementPreview) register.setPlacementPreview(c);
    }

    const motion = c.placeMotion;
    if (motion && (event.activeUid === motion.uid || event.placed === motion.uid)) {
      const mesh = c.itemMeshes.get(motion.uid);
      if (mesh) {
        const p = event.placed ? 1 : event.progress;
        const eased = p * p * (3 - 2 * p);
        mesh.position.x = motion.from.x + (motion.pose.x - motion.from.x) * eased;
        mesh.position.y = motion.from.y + (motion.pose.y - motion.from.y) * eased + Math.sin(Math.PI * p) * 0.10;
        mesh.position.z = motion.from.z + (motion.pose.z - motion.from.z) * eased;
        mesh.rotation.x = motion.fromRotation.x * (1 - eased);
        mesh.rotation.y = motion.fromRotation.y + (motion.pose.ry - motion.fromRotation.y) * eased;
        mesh.rotation.z = motion.fromRotation.z * (1 - eased);
      }
    }

    if (event.placed) {
      const item = c.cart.find((entry) => entry.uid === event.placed);
      if (item) item.placed = true;
      c.checkoutPlacedCount = c.cart.filter((entry) => entry.placed).length;
      c.placeMotion = null;
      if (hooks.sfx) hooks.sfx('productPlace');
      if (register.setPlacementPreview) register.setPlacementPreview(c);
    }
    if (event.complete) {
      c.checkoutPhase = 'waiting';
      if (c.checkoutFlow && c.checkoutFlow.state === 'CustomerPlacingProducts') {
        advanceCustomerCheckout(c, 'WaitingForCashier', 'all-products-placed-sequentially');
      }
    }
    return event.complete;
  }

  function handPlacedItemsToRegister(c) {
    const proxies = c.itemMeshes ? [...c.itemMeshes.entries()] : [];
    for (const [, mesh] of proxies) mesh.removeFromParent();
    const begun = register.begin(c);
    if (begun) {
      for (const [, mesh] of proxies) disposeCustomerProductMesh(c, mesh);
      c.itemMeshes.clear();
      c.checkoutPlacement = null;
      c.placeMotion = null;
      return true;
    }

    // The queue/register invariants normally make this unreachable, but restoring
    // the exact counter poses is safer than letting a transient busy till delete the
    // customer's visible goods.
    for (const [uid, mesh] of proxies) {
      const item = c.cart.find((entry) => entry.uid === uid);
      interior.add(mesh);
      if (item && item.placedAt) {
        mesh.position.set(item.placedAt.x, item.placedAt.y, item.placedAt.z);
        mesh.rotation.set(0, item.placedAt.ry, 0);
      }
    }
    return false;
  }

  function armCustomerCheckoutApproach(c) {
    if (!c || !c.cart || !c.cart.length || c.checkoutApproachArmed) return false;
    c.checkoutApproachArmed = true;
    c.preServiceWait = 0;
    // Organic shoppers previously started this clock at spawn, so browsing and
    // fixture linger consumed a counter-navigation watchdog. Start a fresh flow
    // only when this cart-holder's active route is actually the counter.
    if (!c.checkoutFlow || c.checkoutFlow.state === 'CustomerApproaching') {
      syncCustomerCheckoutFlow(c, createCheckoutFlow({
        state: 'CustomerApproaching',
        nowMs: flowNow(),
      }));
    }
    return true;
  }

  function reconcileCustomerPlacementRecovery(c) {
    syncCustomerItemMeshes(c);
    const recovery = createSequentialPlacementRecovery(c.cart);
    const placed = new Set(recovery.placedUids);
    c.placeMotion = null;

    for (const item of c.cart) {
      const mesh = c.itemMeshes.get(item.uid);
      if (placed.has(item.uid)) {
        if (!mesh || !item.placedAt) continue;
        if (mesh.parent !== interior) interior.add(mesh);
        mesh.position.set(item.placedAt.x, item.placedAt.y, item.placedAt.z);
        mesh.rotation.set(0, item.placedAt.ry, 0);
        continue;
      }
      // Only interrupted/unplaced products return to the customer's carry.
      // Already placed meshes remain at their exact authored counter poses.
      item.placed = false;
      if (mesh && mesh.parent !== c.mesh) c.mesh.add(mesh);
    }
    layoutCustomerCarry(c);
    c.checkoutPlacement = recovery.placement;
    c.checkoutPlacedCount = recovery.placedUids.length;
    c.checkoutPhase = 'placing';
    if (register.setPlacementPreview) register.setPlacementPreview(c);
    return recovery;
  }

  function reconcileCustomerCheckoutTimeout(c, fromState) {
    if (fromState === 'CustomerApproaching') {
      c.path = null;
      c.pathGoal = null;
      c.stuckT = 0;
      c.repathed = false;
      navVersion = -1;
      return true;
    }
    if (fromState === 'CustomerPlacingProducts') {
      reconcileCustomerPlacementRecovery(c);
      return true;
    }
    if (fromState === 'WaitingForCashier') {
      // This checkpoint owns no sale rollback. It only drops unsafe input and
      // cashier camera state while preserving the same register tx/order.
      if (register.getCustomer() === c) {
        if (register.isActive()) register.leave({ restorePointer: false });
        else register.recoverInput('waiting-customer-watchdog');
      }
      return true;
    }
    return false;
  }

  function recoverCustomerCheckoutTimeout(c, nowMs = flowNow()) {
    const flow = c && c.checkoutFlow;
    if (!c.checkoutApproachArmed || !flow
        || !['CustomerApproaching', 'CustomerPlacingProducts', 'WaitingForCashier'].includes(flow.state)
        || !checkoutStateTimedOut(flow, nowMs)) return false;
    const fromState = flow.state;
    const entered = recoverTimedOutCheckout(flow, { nowMs });
    if (!entered.ok) return false;
    syncCustomerCheckoutFlow(c, entered.flow);
    if (!reconcileCustomerCheckoutTimeout(c, fromState)) return true;
    const resumed = resumeCheckout(c.checkoutFlow, { nowMs: nowMs + 0.001 });
    if (!resumed.ok) return true;
    syncCustomerCheckoutFlow(c, resumed.flow);
    if (!Array.isArray(c.checkoutWatchdogEvents)) c.checkoutWatchdogEvents = [];
    c.checkoutWatchdogEvents.push({
      atMs: nowMs,
      fromState,
      resumeState: resumed.flow.state,
      recoverySequence: entered.flow.sequence,
      resumeSequence: resumed.flow.sequence,
      patience: c.patience,
      cartUids: c.cart.map((item) => item.uid),
    });
    c.checkoutWatchdogEvents = c.checkoutWatchdogEvents.slice(-12);
    // The caller skips the remainder of this customer update. Repath, placement,
    // or player waiting can progress from the clean checkpoint next frame only.
    return true;
  }

  function customerPick(c, stop) {
    if (!stop.skus || (c.targetCartSize && c.cart.length >= c.targetCartSize)) return;
    const rng = rngOf(state);
    const stocked = stop.skus.filter((id) => state.shop.inventory[id] && state.shop.inventory[id].shelf > 0);
    if (!stocked.length) {
      // bare display: they glance and move on — and someone occasionally says so
      c.emptyStops = (c.emptyStops || 0) + 1;
      if (rng.chance(0.18) && hooks.toast && walk.active && isInside(walk.x, walk.z)) {
        hooks.toast(`${c.name} looked over the empty ${stop.title || 'display'} and moved on.`, 'warn');
      }
      return;
    }
    if (stop.browseOnly && !rng.chance(0.55)) return;
    // Browse-only visitors may inspect and replace a unit: a visible shelf-count
    // beat with no sale. Planned buyers take exactly one unit at each stop.
    if (stop.browseOnly) {
      const skuId = stocked[rng.int(stocked.length)];
      if (pickFromShelf(state, skuId).ok) {
        rebuildStock(); // the unit leaves the display while they look it over
        returnToShelf(state, skuId);
        c.linger = Math.max(c.linger, 2.2); // the look-it-over beat
        setTimeout(() => { if (interior.parent) rebuildStock(); }, 1600); // and back it goes
      }
      return;
    }
    const skuId = stocked.includes(stop.plannedSku) ? stop.plannedSku : stocked[rng.int(stocked.length)];
    // Each unit gets its own uid. That is what makes two identical Pro-V dozens two
    // PIECES rather than a tally of two — so one can be scanned and the other not,
    // and so a save taken while they are in a shopper's hands can put THEM back.
    const uid = `u${++unitSeq}`;
    if (!pickFromShelf(state, skuId, uid).ok) return;
    const sku = SHOP_CATALOG.find((s) => s.id === skuId);
    c.cart.push({
      uid,
      skuId,
      price: priceFor(sku, state.shop.markup[sku.cat] || 1, null),
      placed: false,
      placedAt: null,
    });
    rebuildStock(); // the display visibly loses the unit
    syncCustomerItemMeshes(c);
    c.checkoutPhase = 'shopping';
    if (hooks.sfx && walk.active && isInside(walk.x, walk.z)) hooks.sfx('product');
    // a pick means they're heading to the counter — make sure a stop exists
    if (!c.stops.some((s, i) => i > c.stopIdx && s.kind === 'counter')) {
      const regW = L2W(COUNTER.registerX, COUNTER.z);
      c.stops.splice(c.stops.length - 2, 0, { kind: 'counter', x: queueSlotW(0).x, z: queueSlotW(0).z, faceX: regW.x, faceZ: regW.z });
    }
  }

  // Put every unpaid unit back on the display, visibly and immediately: shelf
  // credited, hand meshes gone, oversize armfuls gone. The sim never lost the
  // stock (returnToShelf always ran at removal) — but the MESHES used to ride
  // out the door in their arms, which read as shoplifting. Idempotent.
  function surrenderCart(c, { announce = true } = {}) {
    if (!c || !c.cart || !c.cart.length) return false;
    for (const it of c.cart) returnToShelf(state, it.skuId, it.uid);
    state.shop.lostSalesTotal = (state.shop.lostSalesTotal || 0) + 1;
    c.cart = [];
    c.tx = null;
    c.awaitingCheckout = false;
    c.checkoutPlacedCount = 0;
    clearCustomerItemMeshes(c);
    if (c.oversizeCarryRoot) {
      if (c.checkoutProductResources) c.checkoutProductResources.dispose(c.oversizeCarryRoot);
      c.oversizeCarryRoot.removeFromParent();
      c.oversizeCarryRoot = null;
    }
    if (announce && hooks.toast && walk.active && isInside(walk.x, walk.z)) {
      hooks.toast(`${c.name} put back what they were carrying.`, 'warn');
    }
    rebuildStock();
    return true;
  }

  // the line gave up on us: put the pick back, remember the walk-out
  function customerGiveUp(c) {
    if (!c || c.giveUpHandled) return false;
    c.giveUpHandled = true;
    c.impatientBeat = null;
    // they stood there, nobody came, and they put it back. That is a review, and a deserved one —
    // every single time.
    if (!c.reviewed) {
      c.reviewed = true;
      postReview(state, reviewFor(state, {
        waitedSec: c.queuedAt ? Math.max(0, now - c.queuedAt) : 0,
        queueLen: c.queueLenOnArrival || 0,
        bought: false,
        played: !!c.isGolfer,
        foundWhatTheyWanted: false,
      }, Math.round((c.seed || 0) * 1000 + (state.dayAbs || 0))));
    }

    if (c.checkoutFlow && c.checkoutFlow.state !== 'Recovery'
        && c.checkoutFlow.state !== 'TransactionComplete') {
      const recovered = enterCheckoutRecovery(c.checkoutFlow, {
        cause: 'customer-patience-expired',
        nowMs: flowNow(),
      });
      if (recovered.ok) c.checkoutFlow = recovered.flow;
    }
    const hadCart = surrenderCart(c, { announce: false });
    if (hadCart && hooks.toast) {
      // no literal minutes — game clocks and wall clocks disagree, and the player only
      // needs the cause: they were kept waiting too long
      hooks.toast(`${c.name} got tired of waiting, put everything back, and left a bad review.`, 'warn');
    }
    c.checkoutPhase = 'leaving';
    // they walked out mid-sale: void it, clear the counter, and put the goods back.
    // registerMode holds no authority over stock — the shelf is credited right here.
    if (register.getCustomer() === c) { register.abandon(); register.leave(); }
    clearCustomerItemMeshes(c);
    leaveQueue(c);
    c.stopIdx += 1;
    c.linger = 0;
    return true;
  }

  function beginCustomerImpatientBeat(c) {
    if (!c || c.giveUpHandled || c.impatientBeat) return false;
    c.impatientBeat = createCustomerImpatientBeat();
    c.patience = 0;
    setPatience(c);
    const char = c.mesh && c.mesh.userData.char;
    if (char) {
      char.setMode('Impatient');
      char.update(0); // pose on the threshold frame; cleanup cannot pre-empt it
    }
    return true;
  }

  // The ONLY way a shopper leaves the floor. pickFromShelf takes a unit off the shelf the instant
  // they lift it, so a shopper deleted while still holding one destroys it — the player's stock
  // drains for no reason they can see. Three separate removal sites used to do exactly that; they
  // all come through here now, and anything still in their hands goes back on the display.
  function removeCustomer(i) {
    const c = customers[i];
    if (!c) return;

    // They came in, they saw the place, they left. That is a visit, and a visit is reviewable —
    // not just the ones that ended in a sale or a tantrum at the till, which is how most of them
    // used to leave without anyone hearing a word about it. About two in five bother to write.
    if (!c.reviewed && c.entered) {
      c.reviewed = true;
      const seed = Math.round((c.seed || 0) * 1000 + (state.dayAbs || 0));
      if (Math.abs(Math.sin(seed * 7.13)) < 0.42) {
        postReview(state, reviewFor(state, {
          waitedSec: c.queuedAt ? Math.max(0, now - c.queuedAt) : 0,
          queueLen: c.queueLenOnArrival || 0,
          bought: !!c.bought,
          played: !!c.isGolfer,
          foundWhatTheyWanted: !!c.bought,
        }, seed));
      }
    }

    // THE REGISTER HAS TO LET GO OF THEM, and this is the place it must happen.
    //
    // removeCustomer is the single funnel every shopper leaves through — giving up at
    // the till, reaching the exit, the shop closing at eight, the scene being torn
    // down. abandon() lived only in customerGiveUp, so a shopper removed by any OTHER
    // route left register mode holding a live transaction over goods that had already
    // gone back on the shelf (the line below returns them). Finish that sale and it
    // banks revenue for stock you no longer sold: money out of nothing, and the player
    // stranded at a till serving a person who is not there.
    //
    // voidTx() makes the transaction terminal, so completeSale() can never touch it.
    if (register.getCustomer() === c) { register.abandon(); register.leave(); }

    if (c.bought && c.checkoutFlow && c.checkoutFlow.state === 'CustomerLeaving') {
      advanceCustomerCheckout(c, 'TransactionComplete', 'customer-cleared-checkout-zone');
    }

    if (c.cart && c.cart.length) {
      for (const it of c.cart) returnToShelf(state, it.skuId, it.uid);
      c.cart = [];
      if (!disposing) rebuildStock();
    }
    if (c.tx) c.tx = null;
    c.awaitingCheckout = false;
    c.checkoutPhase = 'leaving';
    leaveQueue(c);
    clearCustomerItemMeshes(c);
    if (c.oversizeCarryRoot) {
      if (c.checkoutProductResources) c.checkoutProductResources.dispose(c.oversizeCarryRoot);
      c.oversizeCarryRoot.removeFromParent();
      c.oversizeCarryRoot = null;
    }
    disposeCustomerHandoffReceipt(c);

    // Character resources are captured by makeCharacter before any shared item
    // proxy or paid-bag GLB is parented beneath it, so this cannot evict cached
    // merchandise. The patience indicator is the one customer-local mesh created
    // later by this module and therefore has to be released explicitly here.
    if (c.patienceMesh) {
      c.patienceMesh.removeFromParent();
      if (c.patienceMesh.geometry && typeof c.patienceMesh.geometry.dispose === 'function') {
        c.patienceMesh.geometry.dispose();
      }
      const patienceMaterials = Array.isArray(c.patienceMesh.material)
        ? c.patienceMesh.material
        : [c.patienceMesh.material];
      for (const material of new Set(patienceMaterials)) {
        if (material && typeof material.dispose === 'function') material.dispose();
      }
      c.patienceMesh = null;
    }
    const char = c.mesh.userData.char;
    if (char && typeof char.dispose === 'function') char.dispose();
    custGroup.remove(c.mesh);
    customers.splice(i, 1);
  }

  function sameReservationId(a, b) {
    return a != null && b != null && String(a) === String(b);
  }

  function reservationRecordForCustomer(c) {
    if (!c || c.reservationId == null) return null;
    const booked = state && state.reservations && Array.isArray(state.reservations.booked)
      ? state.reservations.booked
      : [];
    return booked.find((r) => sameReservationId(r.id, c.reservationId)) || null;
  }

  function openReservationCustomer(c) {
    if (!c || c.reservationId == null || c.reservationReleased) return false;
    const reservation = reservationRecordForCustomer(c);
    return !!reservation && reservation.status === 'booked';
  }

  function openWalkInCustomer(c) {
    return !!c
      && c.customerType === 'walk-in-tee'
      && c.reservationId == null
      && !c.reservationReleased
      && !c.walkInRejected;
  }

  function openDeskCustomer(c) {
    return openReservationCustomer(c) || openWalkInCustomer(c);
  }

  function reservationCustomerSnapshot(c) {
    if (!c || c.reservationId == null) return null;
    const reservation = reservationRecordForCustomer(c);
    const reservationStatus = reservation ? reservation.status : 'missing';
    let presentationStatus = 'arriving';
    if (c.reservationReleased) presentationStatus = 'leaving';
    else if (reservationStatus !== 'booked') presentationStatus = reservationStatus;
    else if (c.queued) presentationStatus = 'waiting';
    return {
      reservationId: c.reservationId,
      customerId: c.customerId,
      name: c.name,
      fullName: c.fullName || c.name,
      groupMembers: c.groupMembers ? [...c.groupMembers] : [],
      teeTime: c.teeTime,
      arrivalTime: c.arrivalTime,
      paymentStatus: c.paymentStatus,
      reservationStatus: c.reservationStatus || reservationStatus,
      checkInStatus: c.checkInStatus,
      customerType: c.customerType,
      paymentPreference: c.paymentPreference,
      currentDestination: c.currentDestination,
      status: reservationStatus,
      presentationStatus,
      queued: !!c.queued,
      queueIndex: c.queued ? counterQueue.indexOf(c) : -1,
      phase: c.checkoutPhase,
      released: !!c.reservationReleased,
      exitReason: c.reservationExitReason,
    };
  }

  // Presentation-only release. Reservation status and money remain authoritative
  // in sim/reservations.js; this merely clears the person from the queue and gives
  // their existing route an exit target after check-in has completed.
  function releaseReservationCustomer(c, reason = 'completed') {
    if (!c || c.reservationId == null) return false;
    if (c.reservationReleased) return true;
    c.reservationReleased = true;
    c.reservationExitReason = reason;
    c.checkoutPhase = 'reservation-leaving';
    c.currentDestination = 'exit';
    c.awaitingCheckout = false;
    c.linger = 0;
    c.impatientBeat = null;
    if (c.patienceMesh) c.patienceMesh.visible = false;
    leaveQueue(c);
    const exitIdx = c.stops.findIndex((stop) => stop.kind === 'exit');
    if (exitIdx >= 0) c.stopIdx = exitIdx;
    c.path = null;
    c.pathGoal = null;
    return true;
  }

  // Read lazily by simplifiedRegisterMode after customer simulation has started.
  // The bridge never mutates reservation status or money; it only supplies the due
  // list, resolves the exact waiting person, and releases that presentation after
  // the sim-layer payment has committed.
  B.frontDeskReservations = {
    // due by the book, plus whoever is PHYSICALLY here for a booking — a guest who walks
    // in ten minutes early must show on the desk while they stand at it
    list: () => deskReservationList(
      state,
      customers
        .filter((c) => c.reservationId != null && !c.reservationReleased
          && String(c.checkoutPhase || '').startsWith('reservation'))
        .map((c) => c.reservationId),
    ),
    walkIns: () => customers
      .filter((customer) => openWalkInCustomer(customer))
      .map((customer) => ({
        customerId: customer.customerId,
        name: customer.fullName,
        fullName: customer.fullName,
        partySize: customer.partySize || 1,
        paymentPreference: customer.paymentPreference,
        phase: customer.checkoutPhase,
        queued: customer.queued,
        queueIndex: customer.queued ? counterQueue.indexOf(customer) : -1,
      })),
    customerFor: (id) => customers.find((c) => sameReservationId(c.reservationId, id)) || null,
    readyCustomerFor: (id) => {
      const customer = customers.find((c) => sameReservationId(c.reservationId, id));
      return customer
        && customer.queued
        && counterQueue.indexOf(customer) === 0
        && !customer.reservationReleased
        && customer.checkoutPhase === 'reservation-waiting'
        ? customer
        : null;
    },
    readyWalkInFor: (customerId) => {
      const customer = customers.find((candidate) => candidate.customerId === customerId);
      return customer
        && openWalkInCustomer(customer)
        && customer.queued
        && counterQueue.indexOf(customer) === 0
        && customer.checkoutPhase === 'walk-in-waiting'
        ? customer
        : null;
    },
    walkInSlotsFor: (customerId) => {
      const customer = customers.find((candidate) => candidate.customerId === customerId);
      if (!customer || !openWalkInCustomer(customer)) return [];
      const dayAbs = Math.floor(state.clock.minutes / 1440);
      return walkInAvailability(state, {
        dayAbs,
        partySize: customer.partySize || 1,
      });
    },
    bookWalkIn: (customerId, dayAbs, minute) => {
      const customer = customers.find((candidate) => candidate.customerId === customerId);
      if (!customer || !openWalkInCustomer(customer)) {
        return { ok: false, reason: 'That walk-in request is no longer waiting.' };
      }
      if (!customer.queued || counterQueue.indexOf(customer) !== 0) {
        return { ok: false, reason: 'Serve the customer at the head of the desk first.' };
      }
      const result = selectWalkInSlot(state, {
        customerId: customer.customerId,
        customer: customer.identity,
        name: customer.fullName,
        fullName: customer.fullName,
        paymentPreference: customer.paymentPreference,
        partySize: customer.partySize || 1,
        totalFee: (state.club ? state.club.greenFee : 0) * (customer.partySize || 1),
        dayAbs,
        minute,
      });
      if (!result.ok) return result;
      customer.reservationId = result.res.id;
      customer.customerType = 'walk-in';
      customer.groupMembers = result.res.groupMembers ? [...result.res.groupMembers] : [];
      customer.teeTime = result.res.minute;
      customer.arrivalTime = result.res.arrivalTime;
      customer.paymentStatus = result.res.paymentStatus;
      customer.reservationStatus = result.res.status;
      customer.checkInStatus = result.res.checkInStatus;
      customer.checkoutPhase = 'reservation-waiting';
      customer.currentDestination = 'front-desk';
      result.res.currentDestination = 'front-desk';
      result.res.checkInStatus = 'waiting';
      return { ...result, customer };
    },
    rejectWalkIn: (customerId) => {
      const customer = customers.find((candidate) => candidate.customerId === customerId);
      if (!customer || !openWalkInCustomer(customer)) return false;
      customer.walkInRejected = true;
      customer.checkoutPhase = 'walk-in-leaving';
      customer.currentDestination = 'exit';
      leaveQueue(customer);
      const exitIdx = customer.stops.findIndex((stop) => stop.kind === 'exit');
      if (exitIdx >= 0) customer.stopIdx = exitIdx;
      customer.path = null;
      customer.pathGoal = null;
      return true;
    },
    completeCustomer: (id) => {
      const customer = customers.find((c) => sameReservationId(c.reservationId, id));
      const reservation = customer ? reservationRecordForCustomer(customer) : null;
      if (customer && reservation) {
        customer.paymentStatus = reservation.paymentStatus;
        customer.reservationStatus = reservation.status;
        customer.checkInStatus = reservation.checkInStatus;
      }
      return releaseReservationCustomer(customer, 'checked-in');
    },
  };

  function updateArrivals() {
    if (!state || !state.reservations) return;
    const at = state.clock.minutes;
    for (const reservation of dueForArrivals(state, { at })) {
      markReservationEnRoute(state, reservation.id, at);
    }
    for (const reservation of state.reservations.booked) {
      if (reservation.status !== 'booked' || reservation.willNoShow) continue;
      if (reservation.arrivalStatus === 'en-route' && at >= reservation.plannedArrival) {
        const deskReadyAt = Number(reservation.deskReadyAt ?? (Number(reservation.teeTimeAbs) - 15));
        markReservationArrived(
          state,
          reservation.id,
          at,
          Number.isFinite(deskReadyAt) && at < deskReadyAt ? 'lounge' : 'front-desk',
        );
      }
      if (reservation.arrivalStatus !== 'arrived') continue;
      if (customers.some((customer) => sameReservationId(customer.reservationId, reservation.id))) continue;
      spawnCustomer(true, reservation);
    }
  }

  function leaveQueue(c) {
    const qi = counterQueue.indexOf(c);
    if (qi >= 0) {
      counterQueue.splice(qi, 1);
      c.queued = false;
    }
  }

  function resolveCustomer(c, nx, nz) {
    const r = 0.3;
    for (const col of custCols) {
      if (nx + r > col.minX && nx - r < col.maxX && nz + r > col.minZ && nz - r < col.maxZ) {
        const pushLeft = nx + r - col.minX;
        const pushRight = col.maxX - (nx - r);
        const pushUp = nz + r - col.minZ;
        const pushDown = col.maxZ - (nz - r);
        const min = Math.min(pushLeft, pushRight, pushUp, pushDown);
        if (min === pushLeft) nx = col.minX - r;
        else if (min === pushRight) nx = col.maxX + r;
        else if (min === pushUp) nz = col.minZ - r;
        else nz = col.maxZ + r;
      }
    }
    if (walk.active) {
      const pd = Math.hypot(nx - walk.x, nz - walk.z);
      if (pd > 0.01 && pd < 0.72) {
        nx = walk.x + ((nx - walk.x) / pd) * 0.72;
        nz = walk.z + ((nz - walk.z) / pd) * 0.72;
      }
    }
    for (const o of customers) {
      if (o === c) continue;
      const dx = nx - o.mesh.position.x;
      const dz = nz - o.mesh.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 0.6) {
        nx = o.mesh.position.x + (dx / d) * 0.6;
        nz = o.mesh.position.z + (dz / d) * 0.6;
      }
    }
    return { nx, nz };
  }

  // walkable grid around the building; doors are excluded (they open for walkers)
  const nav = makeNav({
    minX: center.x - 16, maxX: center.x + 16,
    minZ: center.z - 13, maxZ: center.z + 15,
    cell: 0.3, radius: 0.32,
  });
  let navVersion = -1;
  function navFresh() {
    if (navVersion !== colVersion) {
      nav.rebuild(custCols.filter((c) => !c.door));
      navVersion = colVersion;
    }
    return nav;
  }

  // QA determinism: organic walk-ins spawn on a wall-clock probability that is independent
  // of the paused sim clock, so during a long automated acceptance run one can wander in,
  // pick a product up, and corrupt the exactly-once inventory/held assertions. The harness
  // turns this off for the duration of a scripted checkout; it defaults on for normal play.
  let organicWalkins = true;
  function updateCustomers(dt) {
    const minute = ((state.clock.minutes % 1440) + 1440) % 1440;
    const open = minute >= 360 && minute <= 1200;
    const targetCount = open ? clamp(Math.round(((state.shop.salesYesterday.units || 2) / 8) * 3), 1, 6) : 0;
    if (organicWalkins && open && customers.length < targetCount && Math.random() < dt * 0.15) {
      spawnCustomer(false, null, { allowWalkInRequest: true });
    }
    if (!open) {
      for (const c of customers) {
        // A due reservation is an explicit appointment, not an organic walk-in.
        // Once present, it remains serviceable even outside normal shop hours.
        if (openDeskCustomer(c)) continue;
        // Closing time must never tear down the shopper whose transaction is in
        // progress. Their patience is frozen below; preserve the queue and route
        // until the player explicitly finalizes or abandons the transaction.
        if (register.hasTx() && register.getCustomer() === c) continue;
        if (c.stops[c.stopIdx] && c.stops[c.stopIdx].kind !== 'exit' && c.stops[c.stopIdx].kind !== 'gone') {
          leaveQueue(c);
          c.stopIdx = c.stops.length - 2; // head for the exit
          c.linger = 0;
        }
      }
    }

    for (let i = customers.length - 1; i >= 0; i--) {
      const c = customers[i];
      // Cancellation, no-show handling, or successful check-in may close the
      // authoritative booking before the UI explicitly releases its character.
      // In that case it is always safe to let the presentation route leave.
      if (c.reservationId != null && !c.reservationReleased && !openReservationCustomer(c)) {
        const reservation = reservationRecordForCustomer(c);
        releaseReservationCustomer(c, reservation ? `reservation-${reservation.status}` : 'reservation-missing');
      }
      const char = c.mesh.userData.char;
      if (c.impatientBeat) {
        if (char) {
          char.setMode('Impatient');
          char.update(dt);
        }
        const reaction = stepCustomerImpatientBeat(c.impatientBeat, dt);
        if (reaction.complete) customerGiveUp(c);
        continue;
      }
      const checkoutTarget = c.stops[c.stopIdx];
      if (checkoutTarget?.kind === 'counter' && c.cart.length) {
        armCustomerCheckoutApproach(c);
      }
      if (recoverCustomerCheckoutTimeout(c)) continue;
      // Pre-service patience runs on the same ten-real-minute clock as the counter wait.
      // The short watchdogs above reconcile and resume presentation state; only this
      // independent patience fuse may abandon the order, return stock, or write a review.
      if (c.checkoutApproachArmed && c.checkoutFlow
          && ['CustomerApproaching', 'CustomerPlacingProducts', 'WaitingForCashier'].includes(c.checkoutFlow.state)) {
        c.preServiceWait = (c.preServiceWait || 0) + dt;
        if (c.preServiceWait > PATIENCE_FULL) {
          beginCustomerImpatientBeat(c);
          continue;
        }
      } else {
        c.preServiceWait = 0;
      }
      // Keep the completed handoff in the player camera long enough to read as
      // a transfer of ownership. Queue/revenue state has already advanced; this
      // only delays locomotion, so it cannot bank or consume the sale twice.
      if (c.bagAcceptanceHold > 0) {
        if (Number.isFinite(c.bagAcceptanceYaw)) c.mesh.rotation.y = c.bagAcceptanceYaw;
        if (char) {
          char.setMode('ReceiveBag');
          char.update(dt);
        }
        syncPaidBagCarry(c, dt);
        c.bagAcceptanceHold = Math.max(0, c.bagAcceptanceHold - dt);
        const face = c.bagAcceptanceFace;
        if (!Number.isFinite(c.bagAcceptanceYaw) && face) {
          const want = Math.atan2(face.x - c.mesh.position.x, face.z - c.mesh.position.z);
          let dy = want - c.mesh.rotation.y;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          c.mesh.rotation.y += dy * Math.min(1, dt * 8);
        }
        if (c.bagAcceptanceHold === 0) c.bagAcceptanceYaw = null;
        continue;
      }
      if (char) char.update(dt);
      syncPaidBagCarry(c, dt);
      const stop = c.stops[c.stopIdx];
      if (!stop) { removeCustomer(i); continue; }

      // A carried fixture and its stock are intentionally hidden. Hold only
      // the shopper targeting that fixture until set-down retargets the stop;
      // everyone else continues through the live store normally.
      if (stop.kind === 'fixture' && stop.fixtureId
        && builder.isCarrying() === stop.fixtureId) {
        c.path = [];
        c.pathGoal = null;
        c.stuckT = 0;
        c.repathed = false;
        if (char) char.setMode('Idle');
        continue;
      }

      // NOBODY LEAVES HOLDING MERCHANDISE. The moment an unpaid cart-holder's
      // route turns for the door — patience, closing time, any path at all —
      // the goods go back on the display before they take a step. (Paid
      // customers carry a bag, not a cart; their cart emptied at the sale.)
      // Silent: the register give-up path owns the messaging; this net only
      // catches structural leavers and should never narrate.
      if (c.cart.length && (stop.kind === 'exit' || stop.kind === 'gone')) {
        surrenderCart(c, { announce: false });
      }

      let tx = stop.x;
      let tz = stop.z;
      if (stop.kind === 'counter') {
        if (!c.queued) {
          counterQueue.push(c);
          c.queued = true;
          c.queuedAt = now; // the clock a review will quote back at you
          c.queueLenOnArrival = counterQueue.length - 1;
        }
        const slot = queueSlotW(counterQueue.indexOf(c));
        tx = slot.x;
        tz = slot.z;
      }

      const dx = tx - c.mesh.position.x;
      const dz = tz - c.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.18) {
        if (stop.kind === 'enter' && !c.rangBell) {
          c.rangBell = true;
          c.entered = true; // they got through the door, so they have an opinion
          if (hooks.sfx) hooks.sfx('doorbell');
        }
        if (stop.kind === 'lounge') {
          c.checkoutPhase = 'lounge-waiting';
          c.currentDestination = 'lounge';
          const reservation = reservationRecordForCustomer(c);
          if (reservation && reservation.status === 'booked') reservation.currentDestination = 'lounge';
        }
        const holdingInLounge = stop.kind === 'lounge'
          && Number.isFinite(c.loungeUntil)
          && state.clock.minutes < c.loungeUntil;
        const isPass = stop.kind === 'walk' || stop.kind === 'enter' || stop.kind === 'exit' || stop.kind === 'gone';
        const served = stop.kind !== 'counter' || counterQueue.indexOf(c) === 0;
        if (stop.kind === 'gone') {
          removeCustomer(i);
          continue;
        }
        // Reservation guests have no merchandise cart. An open booking holds
        // their real queue position indefinitely until the check-in UI releases
        // them; ordinary closing-time and shopper-patience paths do not apply.
        if (holdingInLounge) {
          c.linger = 0;
          if (char) char.setMode('Idle');
        } else if (stop.kind === 'counter' && openReservationCustomer(c)) {
          c.checkoutPhase = 'reservation-waiting';
          c.currentDestination = 'front-desk';
          const reservation = reservationRecordForCustomer(c);
          if (reservation) {
            reservation.currentDestination = 'front-desk';
            reservation.checkInStatus = 'waiting';
            c.reservationStatus = reservation.status;
            c.checkInStatus = reservation.checkInStatus;
            c.paymentStatus = reservation.paymentStatus;
          }
          c.linger = 0;
          c.patience = PATIENCE_FULL;
          setPatience(c);
          if (char) char.setMode('Idle');
          if (!c.deskGreetingSpoken && counterQueue.indexOf(c) === 0) {
            c.deskGreetingSpoken = true;
            c.dialogue = reservation && (reservation.partySize || 1) > 1
              ? `Hi, we have the ${fmtSlot(reservation.minute)} tee time under ${c.fullName}.`
              : `Hi, I have a reservation under ${c.fullName}.`;
            say(c.dialogue);
          }
        } else if (stop.kind === 'counter' && openWalkInCustomer(c)) {
          c.checkoutPhase = 'walk-in-waiting';
          c.currentDestination = 'front-desk';
          c.linger = 0;
          c.patience = PATIENCE_FULL;
          setPatience(c);
          if (char) char.setMode('Idle');
          if (!c.deskGreetingSpoken && counterQueue.indexOf(c) === 0) {
            c.deskGreetingSpoken = true;
            c.dialogue = `Hi, do you have anything open for ${c.partySize || 1}?`;
            say(c.dialogue);
          }
        // the head of the line with a basket waits for the PLAYER to ring
        // them up — patience runs out eventually and the pick goes back
        } else if (stop.kind === 'counter' && c.cart.length && counterQueue.indexOf(c) === 0) {
          if (!c.deskGreetingSpoken) {
            c.deskGreetingSpoken = true;
            c.dialogue = `Hi, I'm ${c.fullName}. These are all for me.`;
            say(c.dialogue);
          }
          // THE THREE-MINUTE CLOCK starts the moment they stand at the register
          // head — never earlier (browsing costs them nothing), fresh every
          // time they get here.
          if (!c.reachedRegHead) {
            c.reachedRegHead = true;
            c.patience = PATIENCE_FULL;
          }
          if (!c.awaitingCheckout) {
            // One product crosses from their hands to the staging mat at a time.
            // Only after the last settles does registerMode take ownership.
            const placed = updateCustomerPlacement(c, dt);
            if (placed && !register.hasTx()) {
              c.onPaid = (transaction) => onCustomerPaid(c, transaction);
              c.awaitingCheckout = handPlacedItemsToRegister(c);
            }
          }
          // The clock PAUSES only while the cashier is actually at the till
          // working their sale. A transaction parked open while the player
          // wanders the shop is still a customer kept waiting. (The old check
          // skipped isActive(), so a placed customer could never time out —
          // and a pre-handoff one timed out on the SHOPPING clock instead.)
          const activelyServed = register.isActive()
            && register.getCustomer() === c && register.hasTx();
          if (!activelyServed) c.patience -= dt;
          setPatience(c);
          if (char) {
            const flowState = c.checkoutFlow && c.checkoutFlow.state;
            let checkoutMode = c.checkoutPhase === 'placing' ? 'Checkout' : 'Idle';
            if (['ChoosingPayment', 'CardPresented', 'CardSwipeReady', 'CardSwiping',
              'CardProcessing', 'CardApproved', 'CashPresented',
              'PaymentComplete', 'ReceiptPrinting'].includes(flowState)) checkoutMode = 'Present';
            else if (flowState === 'CardDeclined') checkoutMode = 'Declined';
            else if (['SelectingChange', 'GivingChange'].includes(flowState)) checkoutMode = 'Receive';
            else if (['Bagging', 'BagHandoff'].includes(flowState)) checkoutMode = 'ReceiveBag';
            char.setMode(checkoutMode);
          }
          if (c.patience <= 0) beginCustomerImpatientBeat(c);
        } else if (!served) {
          if (char) char.setMode('Idle');
        } else if (!isPass && c.linger > 0) {
          if (char) char.setMode(stop.kind === 'fixture' ? 'Browse' : 'Idle');
          c.linger -= dt;
        } else {
          if (stop.kind === 'fixture') customerPick(c, stop);
          if (stop.kind === 'lounge' && c.reservationId != null) {
            c.checkoutPhase = 'reservation-arriving';
            c.currentDestination = 'front-desk';
            const reservation = reservationRecordForCustomer(c);
            if (reservation) reservation.currentDestination = 'front-desk';
          }
          if (stop.kind === 'counter') leaveQueue(c);
          c.stopIdx++;
          c.linger = 1.5 + Math.random() * 3.5;
          if (c.stopIdx >= c.stops.length) {
            removeCustomer(i);
            continue;
          }
        }
        if (stop.faceX !== undefined) {
          const want = Math.atan2(stop.faceX - c.mesh.position.x, stop.faceZ - c.mesh.position.z);
          let dy = want - c.mesh.rotation.y;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          c.mesh.rotation.y += dy * Math.min(1, dt * 6);
        }
      } else {
        if (char) char.setMode(c.bagMesh ? 'WalkBag' : 'Walk');
        // path on destination change only; string-pulled waypoints thereafter
        if (!c.pathGoal || Math.hypot(c.pathGoal.x - tx, c.pathGoal.z - tz) > 0.22) {
          c.path = navFresh().path(c.mesh.position.x, c.mesh.position.z, tx, tz) || [{ x: tx, z: tz }];
          c.pathGoal = { x: tx, z: tz };
          c.stuckT = 0;
        }
        while (c.path.length > 1
          && Math.hypot(c.path[0].x - c.mesh.position.x, c.path[0].z - c.mesh.position.z) < 0.3) {
          c.path.shift();
        }
        const wp = c.path[0] || { x: tx, z: tz };
        const wdx = wp.x - c.mesh.position.x;
        const wdz = wp.z - c.mesh.position.z;
        const wdist = Math.hypot(wdx, wdz) || 1;
        const step = Math.min(wdist, c.speed * dt);
        const res = resolveCustomer(c, c.mesh.position.x + (wdx / wdist) * step, c.mesh.position.z + (wdz / wdist) * step);
        const moved = Math.hypot(res.nx - c.mesh.position.x, res.nz - c.mesh.position.z);
        c.mesh.position.x = res.nx;
        c.mesh.position.z = res.nz;
        c.mesh.rotation.y = Math.atan2(wdx, wdz);
        // stuck detection: 1.2s pinned → one repath against the fresh world;
        // 3s pinned → sidestep off whatever is holding them and start over
        if (step > 0.001 && moved < step * 0.25) {
          c.stuckT = (c.stuckT || 0) + dt;
          if (c.stuckT > 3.0) {
            const side = Math.random() < 0.5 ? 1 : -1;
            const sres = resolveCustomer(c, c.mesh.position.x + (wdz / wdist) * 0.6 * side, c.mesh.position.z - (wdx / wdist) * 0.6 * side);
            c.mesh.position.x = sres.nx;
            c.mesh.position.z = sres.nz;
            c.pathGoal = null;
            c.stuckT = 0;
            c.repathed = false;
          } else if (c.stuckT > 1.2 && !c.repathed) {
            c.pathGoal = null;
            navVersion = -1; // rebake — a door or hauled pile may have changed the world
            c.repathed = true;
          }
        } else if (moved > step * 0.6) {
          c.stuckT = 0;
          c.repathed = false;
        }
      }
      c.mesh.position.y = groundYAt(c.mesh.position.x, c.mesh.position.z) ?? heightAt(c.mesh.position.x, c.mesh.position.z);
    }
  }

  // --- per-frame update -------------------------------------------------------------------
  let now = 0;
  let poll = 0;
  let visClock = 0;

  // Render-only visibility sync. Prewarm uses this after applying an editor
  // camera so the shader draw sees the same PointLight set as the first live
  // editor frame, without advancing customers, deliveries, or checkout state.
  function syncCameraVisibility() {
    const visible = clubhouseInteriorVisibleAt(
      camera.position.x,
      camera.position.z,
      center.x,
      center.z,
    );
    interior.visible = visible;
    return visible;
  }

  function update(dtMs) {
    const dt = Math.min(0.1, dtMs / 1000);
    now += dt;
    // A mopped floor dries and sprayed solution flashes off. dryTick reports whether anything
    // actually moved so an already-dry floor costs one comparison rather than a repaint.
    if (dryTick(state, dt)) wetVisualDirty = true;
    // Repainting the wet layer is a 4,264-cell canvas write; at ~12 Hz it is invisible to the
    // player and costs a fraction of doing it every frame while a mop is down.
    if (wetVisualDirty) {
      wetRepaintClock += dt;
      if (wetRepaintClock >= 0.08) {
        wetRepaintClock = 0;
        wetVisualDirty = false;
        repaintWet();
      }
    }
    sheet06Production.update(dt);
    updateDoors(dt, now);
    if (deliveryEquipment) {
      deliveryEquipment.update(dt);
      syncEquipmentBoxViews();
      syncCoupledDeliveryPalletLift();
      syncDeliveryVanColliders();
      if (equipmentColliderSyncSeconds > 0) {
        equipmentColliderSyncSeconds = Math.max(0, equipmentColliderSyncSeconds - dt);
        syncStaticDeliveryColliders('delivery_hand_truck');
        syncStaticDeliveryColliders('delivery_pallet_jack');
      }
    }
    updateBoxPlacementPreview();
    updateDeliveryBoxTransfers(dt);
    updateCustomers(dt);
    register.update(dt);
    updateStockFlights(dt);
    updateBoxLifecycleAnimations(dt);
    updateRecyclingDrop(dt);
    updateFlicker(dt);
    builder.update();
    if (office.updateLid) office.updateLid(dt);
    if (moteFade > 0) {
      moteFade -= dt;
      if (moteFade <= 0) motes.visible = false;
    }
    // the set-down / put-away prompt rides just ahead of a loaded player (a box OR an armful)
    if (carriedBoxMesh || carriedGoodsMesh) {
      carryProp.x = walk.x - Math.sin(walk.yaw) * 0.9;
      carryProp.z = walk.z - Math.cos(walk.yaw) * 0.9;
      if (carriedBoxMesh) {
        const carryBob = Math.sin(now * 6.2) * 0.012;
        const carried = carriedBox(state);
        const configuredBaseY = Number(carriedBoxMesh.userData.deliveryCarryBaseY);
        const flatBaseY = Number.isFinite(configuredBaseY)
          ? configuredBaseY
          : (carried?.flat ? -0.34 : -0.70);
        const dropProgress = recyclingDrop ? recyclingDrop.progress : 0;
        const dropEase = dropProgress * dropProgress * (3 - 2 * dropProgress);
        const drop = dropEase * 0.72;
        carriedBoxMesh.position.y = flatBaseY + carryBob - drop;
        carriedBoxHands.position.y = carryBob - drop;
      }
      if (carriedGoodsMesh) {
        const goodsBob = Math.sin(now * 6.2) * 0.01;
        const configuredBaseY = Number(carriedGoodsMesh.userData.deliveryCarryBaseY);
        carriedGoodsMesh.position.y = (Number.isFinite(configuredBaseY) ? configuredBaseY : -0.28) + goodsBob;
        carriedBoxHands.position.y = goodsBob;
      }
    } else {
      carryProp.x = 1e6; // parked far away so an empty-handed player never focuses it
    }
    poll += dt;
    if (poll > 1.1) {
      poll = 0;
      updateArrivals();
      if (boxSignature() !== boxSig) rebuildBoxes(); // the truck came, or staff unboxed
      if (office.paintScreen && interior.visible) office.paintScreen(); // live clock on the lid
      const ds = decorSignature();
      if (ds !== decorSig) {
        decorSig = ds;
        rebuildDecor();
        refreshCondition();
      }
      const ss = stockSignature();
      if (ss !== stockSig) {
        stockSig = ss;
        rebuildStock();
      }
    }
    // interior detail only draws when someone could actually see it
    visClock += dt;
    if (visClock > 0.5) {
      visClock = 0;
      syncCameraVisibility();
    }
  }

  // --- boot -----------------------------------------------------------------------------
  rebuildReno();
  rebuildStock();
  rebuildBoxes();
  stockSig = stockSignature();
  // Everything rebuildStock() closes over now exists, so it is safe to let the
  // model loader call back into it when the goods land.
  merch.onReady(() => {
    if (!interior || !interior.parent) return;
    rebuildStock();
    rebuildBoxes();
    // Fixture and register kit callbacks also populate long-lived empty roots.
    // This final ready callback runs after those registrations and establishes
    // a zero-caster startup invariant for the entire indoor subtree.
    suppressInteriorSunShadows(interior);
  });

  // Walls, roof, porch, grime decals, and exterior dressing never change their
  // transforms after construction. Door hinges are the deliberate exception:
  // their subtrees remain auto-updating so normal E interactions keep swinging.
  // Visibility and material changes (washing, weeds, the porch light) do not need
  // matrix recomposition and continue to work on frozen objects.
  {
    const movingDoorRoots = new Set(doors.map((door) => door.hinge));
    group.updateMatrixWorld(true);
    const freezeShellBranch = (object) => {
      if (movingDoorRoots.has(object)) return;
      object.matrixAutoUpdate = false;
      object.matrixWorldNeedsUpdate = false;
      for (const child of object.children) freezeShellBranch(child);
    };
    freezeShellBranch(group);
  }

  function dispose() {
    if (disposing) return disposalSummary;
    disposing = true;
    register.leave({ restorePointer: false });
    const sheet06ProductionDisposal = sheet06Production.dispose();
    // The 71-100 dressing is NOT released here. Its meshes are GLB clones, and this teardown's
    // rule for loader clones is that the cache which produced them owns freeing them — the same
    // boundary createMerch and the Sheet-6 isolated cache sit behind. Freeing them from this side
    // as well is a double release, which tests/clubhouse-resource-lifecycle.test.js counts.
    // `props71to100.dispose()` exists for rebuilding the dressing on its own, not for teardown.
    const boxPlacementDisposal = boxPlacementMode?.dispose?.() || null;
    deliveryBoxTransfers.clear();
    deliveryBoxTransferHistory.length = 0;
    deliveryTransferBatch = null;
    deliveryPendingBoxIds.clear();
    deliveryLoadPlansByArrivalId.clear();
    deliveryActiveLoad = null;
    deliveryCargoSnapshot = Object.freeze({
      orderId: null, arrivalId: null, loadId: null, loadIndex: null, loadCount: 0,
      planned: [], overflowBoxIds: [],
    });
    for (const id of [...boxViews.keys()]) removeBoxView(id, true);
    // removeBoxView owns and releases the carried box view too. Clear the stale
    // alias before collecting static roots so it cannot be disposed twice.
    carriedBoxMesh = null;
    for (const [id, entry] of shipLabelCache) {
      entry.tex.dispose();
      entry.mat.dispose();
      shipLabelCache.delete(id);
    }
    if (carriedGoodsMesh) {
      disposeProceduralDelivery(carriedGoodsMesh);
      carriedGoodsMesh = null;
    }
    // tearing the scene down must not pocket whatever shoppers were holding: the save is written
    // from `state`, and stock in a deleted shopper's hands would simply cease to exist.
    for (let i = customers.length - 1; i >= 0; i--) removeCustomer(i);

    const equipmentBorrowedResources = deliveryEquipment?.borrowedResources?.() || null;
    clearDeliveryVanColliders();
    const deliveryEquipmentDisposal = deliveryEquipment?.dispose?.() || null;
    deliveryArrivalHandles.clear();
    deliveryArrivalPresentations.clear();

    const staticRoots = [
      group, interior, custGroup, motes, boxGroup, carriedBoxHands,
      washing.jet, washing.mist,
      ...(ctx.extraMeshes || []),
    ];
    const looseResources = mergeRenderableResources(
      materialKitResources,
      collectMaterialResources([
        cardboardDark, tapeMat, paperMat, shipLabelMat, ghostMat,
        ...labelCache.values(), ...skuMats.values(), ...ballBoxMats.values(),
      ]),
    );
    looseResources.geometries.add(BALL_BOX_GEO);
    looseResources.geometries.add(CARTON_GEO);
    looseResources.geometries.add(patRing);
    const ownedResources = mergeRenderableResources(
      collectRenderableResources(staticRoots), looseResources,
    );
    const protectedResources = mergeRenderableResources(
      protectedRenderableResources,
      equipmentBorrowedResources,
      merch.ownedResources ? merch.ownedResources() : null,
      // Assets 71-100 are GLB clones. Like every other loader clone in this teardown, the cache
      // that produced them owns releasing them — the procedural walk must not free them a second
      // time. `interior` is a staticRoot, so without this the walk reaches straight into them.
      collectRenderableResources([props71to100.group]),
    );

    camera.remove(carriedBoxHands);
    scene.remove(group, interior, custGroup, motes, boxGroup, washing.jet, washing.mist);
    for (const p of [...registeredProps]) removeProp(p);
    for (const c of [...registeredCols]) removeCol(c);
    for (const m of ctx.extraMeshes || []) scene.remove(m);

    // Release procedural/static resources once, while loader-owned clone data
    // remains exclusively under createMerch's ownership boundary.
    const procedural = disposeRenderableResources(ownedResources, protectedResources);
    const merchandise = merch.dispose ? merch.dispose() : null;
    deliveryEquipment = null;
    boxPlacementMode = null;
    disposalSummary = Object.freeze({
      procedural,
      merchandise,
      deliveryEquipment: deliveryEquipmentDisposal,
      boxPlacement: boxPlacementDisposal,
      sheet06Production: sheet06ProductionDisposal,
    });
    return disposalSummary;
  }

  return {
    group, interior,
    update, syncCameraVisibility, rebuildStock, rebuildReno, refreshCondition, repaintGrime,
    rebuildBoxes, presentDeliveryArrival, renderDeliveryCarryOverlay,
    sheet06Production: sheet06ProductionPublic,
    sheet06ProductionReady: () => sheet06Production.ready,
    boxPlacement: Object.freeze({
      isActive: () => !!boxPlacementMode?.isActive(),
      hasCarriedBox: () => !!carriedBox(state),
      isTransitioning: () => !!recyclingDrop,
      activate: () => beginCarriedBoxPlacement({ force: true }),
      commit: commitCarriedBoxPlacement,
      rotate: () => (!recyclingDrop && boxPlacementMode?.rotate()) || false,
      cancel: cancelCarriedBoxPlacement,
      label: boxPlacementLabel,
      diagnostics: () => ({
        ...(boxPlacementMode?.diagnostics() || {}),
        boxId: placementBoxId,
        dismissedBoxId: placementDismissedBoxId,
        transitioning: !!recyclingDrop,
        occluderDistance: placementOccluderDistance,
        occluderName: placementOccluderName,
        occlusionChecks: placementOcclusionChecks,
      }),
    }),
    assetsReady: () => merch.isReady(),
    stockDisplayDiagnostics,
    deliveryEquipmentReady: () => !!deliveryEquipment?.isReady(),
    deliveryBoxPresentationDiagnostics,
    deliveryEquipmentDiagnostics: () => {
      const diagnostics = deliveryEquipment?.diagnostics() || null;
      if (!diagnostics?.palletJack) return diagnostics
        ? { ...diagnostics, boxPresentation: deliveryBoxPresentationDiagnostics() }
        : diagnostics;
      return {
        ...diagnostics,
        boxPresentation: deliveryBoxPresentationDiagnostics(),
        palletJack: {
          ...diagnostics.palletJack,
          coupling: deliveryPalletCouplingDiagnostics(),
        },
      };
    },
    deliveryEquipmentMetrics: () => deliveryEquipment?.metrics() || null,
    deliveryEquipmentPose: (asset, nodeName = null) => {
      if (!deliveryEquipment) return null;
      if (nodeName) return deliveryEquipment.nodeWorldPose(asset, nodeName);
      const root = deliveryEquipment.rootFor(asset);
      if (!root) return null;
      root.updateWorldMatrix(true, false);
      return {
        position: root.getWorldPosition(new THREE.Vector3()),
        quaternion: root.getWorldQuaternion(new THREE.Quaternion()),
        visible: root.visible,
      };
    },
    carrySpeedFactor: () => carrySpeedFactor(state),
    carryCollisionRadius: () => {
      const box = carriedBox(state);
      if (!box || box.flat) return 0;
      const dim = boxDims(box.box || 'carton');
      // The long case is carried lengthwise on a 0.78 rad ground-plane
      // diagonal. Its half-span across a doorway is about 0.51 m, so the 0.53 m
      // profile protects its physical corners and clears the open hinge leaf.
      // Treating its full length as a circle makes the receiving route
      // impossible even though the authored case visibly fits lengthwise.
      if (box.box === 'clubbox') return 0.53;
      return Math.max(dim.w, dim.d) * 0.5 + 0.16;
    },
    isInside, groundYAt, vacuumAt, vacuumLabelAt,
    doorWorld: doorW,
    laptopPose: (fovDeg, aspect) => (office.seatPose ? office.seatPose(fovDeg, aspect) : null),
    laptopLid: (open) => office.setLid && office.setLid(open),
    laptopBoot: () => office.startBoot && office.startBoot(),
    laptopScreen: (mode) => office.paintScreen && office.paintScreen(mode),
    laptopScreenMode: () => (office.screenMode ? office.screenMode() : null),
    laptopScreenCorners: () => (office.screenCorners ? office.screenCorners() : null),
    laptopRig: () => (office.laptopObject
      ? { object: office.laptopObject, lidAngle: office.lidAngle(), lidOpen: office.lidOpenAngle, LAPTOP }
      : null),
    confirmChange: () => regConfirmChange(), // dead: change goes into a hand now, not a keypress
    // REGISTER MODE — main.js routes the pointer and the keyboard in here while it is up
    register: {
      isActive: () => register.isActive(),
      hasTx: () => register.hasTx(),
      enter: () => register.enter(),
      leave: () => register.leave(),
      onDown: (e) => register.onDown(e),
      onMove: (e) => register.onMove(e),
      onUp: (e) => register.onUp(e),
      onWheel: (deltaY, shiftKey) => register.onWheel(deltaY, shiftKey),
      onKey: (k) => register.onKey(k),
      recoverInput: (reason) => register.recoverInput(reason),
      tapTerminal: () => register.tapTerminal(),
      // read-only, for the HUD and for tools/qa — the transaction is never mutated
      // from out here; every verb goes through the module above
      getTx: () => register.getTx(),
      getCustomer: () => register.getCustomer(),
      getFlow: () => register.getFlow(),
      scanPresentation: () => register.scanPresentation(),
      scanAlignment: () => register.scanAlignment(),
      cashHandoffPresentation: () => register.cashHandoffPresentation(),
      deliveryPresentation: () => register.deliveryPresentation(),
      drawerPrewarmStatus: () => register.drawerPrewarmStatus(),
      cashGpuPrewarmStatus: () => register.cashGpuPrewarmStatus(),
      waitForCashGpuPrewarmRepresentatives: (timeoutMs) => (
        register.waitForCashGpuPrewarmRepresentatives(timeoutMs)
      ),
      releaseCashGpuPrewarmRepresentatives: (options) => (
        register.releaseCashGpuPrewarmRepresentatives(options)
      ),
      deliveryPhase: () => register.deliveryPhase(),
      hint: () => register.hint(),
      monitorActionPoint: (id) => register.monitorActionPoint(id),
      monitorScreenPoint: (id) => register.monitorScreenPoint(id),
      cardXScreenPoint: () => register.cardXScreenPoint(),
      presentedCashScreenPoint: () => register.presentedCashScreenPoint(),
      presentedCardScreenPoint: () => register.presentedCardScreenPoint(),
      cardTerminalScreenPoint: () => register.cardTerminalScreenPoint(),
      swipeAt: () => register.swipeAt(),
      cardTerminalLocked: () => register.cardTerminalLocked(),
      monitorHotspots: () => register.monitorHotspots(),
      workspace: () => register.workspace(),
      // development-only diagnostics; never surfaced in player UI
      paymentStats: () => paymentDistributionReport(state),
      debugPickAt: (x, y) => register.debugPickAt(x, y),
    },
    // DIAGNOSTICS. Not a cheat: sendToCounter() puts a shopper at the head of the
    // queue holding goods it took off the shelf through pickFromShelf, exactly as if
    // it had walked the floor and chosen them — real shelf debits, real held-unit
    // uids. It skips the browsing, not the accounting. tools/qa/ drives the checkout
    // through it, because waiting on the RNG to produce a two-item cash customer is
    // not a test, it is a lottery.
    customers: () => customers,
    checkoutQueue: () => counterQueue.map((customer) => ({
      customerId: customer.customerId,
      name: customer.name,
      fullName: customer.fullName || customer.name,
      customerType: customer.customerType,
      paymentPreference: customer.paymentPreference,
      reservationId: customer.reservationId,
      status: customer.reservationId != null
        ? (reservationRecordForCustomer(customer)?.status || 'missing')
        : customer.checkoutPhase,
      awaitingCheckout: !!customer.awaitingCheckout,
      phase: customer.checkoutPhase,
    })),
    reservationCustomer: (id) => {
      const customer = customers.find((c) => sameReservationId(c.reservationId, id));
      return reservationCustomerSnapshot(customer);
    },
    completeReservationCustomer: (id) => {
      const customer = customers.find((c) => sameReservationId(c.reservationId, id));
      if (!customer) return { ok: false, reason: 'reservation-customer-not-found' };
      const alreadyReleased = customer.reservationReleased;
      releaseReservationCustomer(customer, 'completed');
      return { ok: true, alreadyReleased, customer: reservationCustomerSnapshot(customer) };
    },
    sendToCounter(skuIds, payMethod = null) {
      const c = spawnCustomer(false);
      if (!c) return null;
      // An explicit method is the scripted/QA override; otherwise the customer
      // keeps the balanced-bag preference they drew at spawn.
      if (payMethod === 'cash' || payMethod === 'card') c.payMethod = payMethod;
      for (const skuId of skuIds) {
        const uid = `u${++unitSeq}`;
        if (!pickFromShelf(state, skuId, uid).ok) continue;
        const sku = SHOP_CATALOG.find((k) => k.id === skuId);
        c.cart.push({
          uid,
          skuId,
          price: priceFor(sku, state.shop.markup[sku.cat] || 1, null),
          placed: false,
          placedAt: null,
        });
      }
      if (!c.cart.length) return null;
      c.targetCartSize = c.cart.length;
      c.checkoutPhase = 'shopping';
      c.checkoutPlacedCount = 0;
      c.checkoutPlacement = null;
      c.checkoutFlow = createCheckoutFlow({ nowMs: flowNow() });
      rebuildStock();
      const q = queueSlotW(0);
      c.mesh.position.set(q.x, c.mesh.position.y, q.z);
      const regW = L2W(REGISTER.scanner.x, COUNTER.z);
      c.stops = [
        { kind: 'counter', x: q.x, z: q.z, faceX: regW.x, faceZ: regW.z },
        { kind: 'exit', x: doorW.x, z: doorW.z },
        { kind: 'gone', x: doorW.x, z: doorW.z + 6 },
      ];
      c.stopIdx = 0;
      c.linger = 0;
      c.entered = true;
      return c.name;
    },
    productThumb: (sku) => productThumb(sku), // rendered supplier-card imagery
    condition: () => conditionNow,
    setTimeMood: (minuteOfDay) => shell.lighting.setTimeMood(minuteOfDay),
    // build mode: the shop is the player's to arrange
    build: builder,
    // the pressure washer: aim at the building, pull the trigger, watch the wall come back
    washAim: (origin, dir) => washing.aim(origin, dir),
    washApply: (hit, mode, radius, power, dt, now) => {
      const r = washing.apply(hit, mode, radius, power, dt, now);
      if (r.cleaned > 0) washing.announceIfDone(hit.id);
      return r;
    },
    // assets 71-100 dressing
    props71to100: {
      ready: props71to100.ready,
      diagnostics: () => props71to100.diagnostics(),
    },
    washJet: (from, to, on, dt) => washing.setJet(from, to, on, dt),
    washTick: (dt) => washing.tick(dt),
    // the cleaning kit: one entry point, dispatched on the tool's declared class. Callers pass
    // the tool's own socket point in world space — never a guess taken off the camera.
    cleanWithTool,
    debrisTotal: () => totalDebris(state),
    debrisCount: () => debrisState(state).length,
    panLoad: () => state.shop.reno.pan || 0,
    bagLoad: () => state.shop.reno.bag || 0,
    emptyPan: () => {
      const had = state.shop.reno.pan || 0;
      state.shop.reno.pan = 0;
      state.shop.reno.bag = Math.round(((state.shop.reno.bag || 0) + had) * 1000) / 1000;
      return had;
    },
    disposeBag: () => {
      const had = state.shop.reno.bag || 0;
      state.shop.reno.bag = 0;
      return had;
    },
    customers, doors, // QA access
    debugSpawn: spawnCustomer, // QA: force a walk-in
    setOrganicWalkins: (on) => { organicWalkins = !!on; }, // QA: silence random walk-ins for a scripted run
    clearWalkins: () => { // QA: empty the floor (returns every held cart to the shelf) so a scripted run starts clean
      for (let i = customers.length - 1; i >= 0; i--) removeCustomer(i);
    },
    dispose,
  };
}

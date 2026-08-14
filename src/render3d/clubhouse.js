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
import { t } from '../core/i18n.js';
import { notify } from '../sim/notifications.js';
import { fitDistance } from '../core/screenFit.js';
import { clamp, rngOf } from '../core/utils.js';
import { LAPTOP, screenCornersLocal, screenNormalLocal } from '../core/laptopRig.js';
import { characterYawToward, makeCharacter } from './characterAsset.js';
import { makeSoftParticleTexture } from './proceduralTextures.js';
import { SHOP_CATALOG, SHELF_CAP, DECOR_SPOTS } from '../data/shopItems.js';
import {
  SHELL, INTERIOR, FIXTURES, FIXTURE_HALF, COUNTER, OFFICE, STOCKROOM, LOUNGE,
  DOOR_MAIN, DOOR_STOCK, DOOR_BACK,
  FRONT_DESK, FRONT_DESK_FRAME, MAT, BASKET_STATION, HOURS_SIGN, LOGO_RUG, queueSlot, REGISTER,
  COUNTER_TOP, fixtureBrowsePoint, frontDeskPoint,
  CLUBHOUSE_LAYOUT_VARIANT,
  CLUBHOUSE_VARIANT_REQUEST,
  PINE_HILLS_V2_LAYOUT,
} from '../data/shopLayout.js';
import {
  RENO, shopCondition, cleanGrimeAt, clearClutter, placeDecor, removeDecor,
  removeDecorPlacement,
  restockShelfFromBackroom, priceFor, windowDirtAvg,
} from '../sim/shop.js';
import {
  placedPropertyItems,
  setPlacementComponentState,
  setPlacementLightPower,
  setPlacementSpotlightAim,
} from '../sim/propertyInventory.js';
import { buildPropertyFurnitureVisual } from './clubhouse/propertyFurnitureVisuals.js';
import { createLedgerBook } from './clubhouse/ledgerBook.js';
import {
  boxesOf, pickUpBox, putDownBox, carriedBox, openBox, emptyTrash,
  openFlap, takeFromBox, flattenBox, recycleCarriedBox,
  tapeCut, flapsOpen, isEmpty, boxState,
  beginBoxStep, nextBoxStep, BOX_STEP,
  deliveryEquipmentPlacementForCarriedBox,
  handTruckPlacementForCarriedBox, stockingCartPlacementForCarriedBox, PAD_CAPACITY,
} from '../sim/deliveries.js';
import { allocateBackroomCases, backroomCaseSlots } from './backroomStock.js';
import {
  carriedGoods, stockFixture, storeInBack, carrySpeedFactor,
} from '../sim/stocking.js';
import {
  reconcileRetailShelfStock,
  reconcileRetailShelfStorage,
  retailShelfAssignedUnits,
  retailShelfAssignments,
  retailShelfPlacementSummary,
  retailShelfStorageAssignments,
  retailShelfStorageSummary,
  storeRetailShelfCabinet,
  stockRetailShelf,
  takeFromRetailShelfCabinet,
  takeFromRetailShelf,
} from '../sim/retailShelfStocking.js';
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
import {
  abandonUnit, stageUnit, visibleBasketSlots,
} from '../sim/customerBasket.js';
import { drawPaymentMethod, paymentDistributionReport } from '../sim/paymentBag.js';
import { addRevenue } from '../sim/economy.js';
import { triggerContextTutorial, tutorialFlag } from '../sim/tutorial.js';
import {
  campaignAllowsBusiness,
  campaignZoneProgress,
  facilityInstalled,
  recordCampaignCleaning,
  recordCampaignEvent,
  repairComplete,
} from '../sim/campaign.js';
import { starterRetailPresentation } from '../sim/clubhouseStarterStock.js';
// One predicate for "is the ceiling ring live". It used to be open-coded in
// four places here and nowhere the sim could see it.
import { ceilingCircuitPowered as ceilingCircuitPoweredSim } from '../sim/clubhouseRestoration.js';
import {
  dueForCheckIn, dueForArrivals, markReservationEnRoute, markReservationArrived,
  walkInAvailability, selectWalkInSlot, fmtSlot, deskReservationList,
  slotTimes, availableSlots, resolveTeeTimeRequest, reservationById,
  // (the walk-in ask rule lives in the sim; see the import below)
} from '../sim/reservations.js';
import {
  walkInAskFrom, queuePositionMayAbandon, queueAdvanceSlot, queueSlotIsClear,
} from '../sim/customerSimulation.js';
import { steerAround, STEER_DEFAULTS } from './clubhouse/steerAhead.js';
import { BODY_RADIUS, avoidanceHeading, separate } from './clubhouse/crowd.js';
import {
  allocateCustomerIdentity, customerIdentityById, paymentChoiceDialogue,
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
  canBuildDeliveryBoxVisual, createDeliveryBoxVisual, normalizedFourFlaps,
} from './clubhouse/deliveryBoxVisual.js';
import {
  deliveryBoxCarryCollisionRadius,
  deliveryBoxCarryProfile,
} from './clubhouse/deliveryCarryProfile.js';
import { slotsFor, homeFixture } from '../data/fixtureSlots.js';
import { BROOM_FEEL } from '../data/broomFeel.js';
import { buildShell } from './clubhouse/shell.js';
import { buildShedShell } from './clubhouse/shedShell.js';
import { SHED_ROOM } from '../data/shedLayout.js';
import { buildShopProgressionVisuals } from './clubhouse/shopProgressionVisuals.js';
import { buildDoors } from './clubhouse/doors.js';
import { createClubhouseArchitecturalDoorInstallation } from './clubhouse/architecturalDoorInstallation.js';
import { createFirstDoorVisibilityReady } from './clubhouse/firstDoorVisibilityReady.js';
import { createCeilingCircuitRenderSync } from './clubhouse/ceilingCircuitRenderSync.js';
import { createSheet06ProductionRuntime } from './assets51to100/sheet06ProductionRuntime.js';
import { createSheet06NavigationContract } from './assets51to100/sheet06Navigation.js';
import {
  createModernPublicClubhouse,
  MODERN_CLUBHOUSE_BUILDING_WIDTH_METERS,
  MODERN_CLUBHOUSE_CART_BARN_X_METERS,
  MODERN_CLUBHOUSE_MAIN_DOOR_X_METERS,
  MODERN_CLUBHOUSE_METERS_TO_YARDS,
} from './clubhouse/modernPublicClubhouse.js';
import { buildFixtures, buildLounge, buildStockroomDressing, buildCheckout } from './clubhouse/fixtures.js';
import {
  fixtureIsInstalled, shopCustomerCapacity, shopTierIndex,
} from '../sim/shopProgression.js';
import { createRegisterMode } from './clubhouse/simplifiedRegisterMode.js';
import { flipSign, shopAcceptsWalkIns, signIsOpen } from '../sim/shopSign.js';
import { shopSignLocalPoint } from '../data/shopSignPlacement.js';
import { createOpenClosedSignRegistry, exteriorSignFace } from './clubhouse/openClosedSigns.js';
import { shopFootfallDrive, shopFootfallTarget } from '../sim/shopFootfall.js';
import { buildDirt } from './clubhouse/dirt.js';
import { buildShedDirt } from './clubhouse/shedDirt.js';
import { createShedInterior } from './clubhouse/shedInterior.js';
import { createPineHillsInterior } from './clubhouse/pineHillsInterior.js';
import { createPineHillsV2Interior } from './clubhouse/pineHillsV2Interior.js';
import { productThumb } from './clubhouse/thumbs.js';
import { buildExterior } from './clubhouse/exterior.js';
import { buildWashing } from './clubhouse/washing.js';
import { buildCampaignWorld } from './clubhouse/campaignWorld.js';
import { makeNav } from './clubhouse/nav.js';
import {
  createMountainLodge,
  MOUNTAIN_LODGE_BUILDING_DEPTH_METERS,
  MOUNTAIN_LODGE_BUILDING_WIDTH_METERS,
  MOUNTAIN_LODGE_METERS_TO_YARDS,
} from './clubhouse/mountainLodge.js';
import {
  createResortClubhouse,
  RESORT_CLUBHOUSE_METERS_TO_YARDS,
} from './clubhouse/resortClubhouse.js';
import {
  createPremiumCountryClub,
  PREMIUM_COUNTRY_CLUB_METERS_TO_YARDS,
} from './clubhouse/premiumCountryClub.js';
// The cached loader, not the bare one: assets 61-100 are the sheet_07/sheet_08
// pro-shop set, they share material families with each other, and the cached
// loader is what runs cross-file texture interning and attaches the KTX2
// transcoder. On the bare GLTFLoader every asset paid for its own copy of a
// shared walnut or steel map. See sharedTexturePool.js.
import { CachedGLTFLoader as GLTFLoader } from './gltfCache.js';
import { buildProps } from './assets51to100/propPlacement.js';
import { RUNTIME_ASSET_MANIFEST_BY_NUMBER } from './assets51to100/runtimeManifest.js';
import {
  ensureDebris, debrisState, seedDebris, sweepAt, collectAt, suckAt, totalDebris,
  syncGenericCleanupMilestone,
} from '../sim/cleaningDebris.js';
import {
  ensureWet, wetAt, solutionAt, solutionLevel, consumeSolution, dryTick, SOLUTION_MIN,
  wetGridForRoom,
} from '../sim/cleaningWet.js';
import {
  CLEANING_TOOLS, TOOL_CLASS, MEDIUM, MEDIUM_STYLE, toolMedia, toolDebrisKinds,
} from '../data/cleaningTools.js';
import {
  ensureCleaningToolState, cleaningStatus, panSpace, bagSpace, addToPan, addToBag,
  emptyPanIntoBag, tieBag, disposeTiedBag, serviceMop, changeBucketWater,
  consumeMopCharge,
} from '../sim/cleaningToolState.js';
import {
  planOrganicOrder, reconcileCustomerItemMeshes,
  createSequentialPlacement, createSequentialPlacementRecovery, stepSequentialPlacement,
  createCustomerImpatientBeat, stepCustomerImpatientBeat,
} from './clubhouse/customerFlow.js';
import {
  PAID_BAG_ACCEPTANCE_HOLD_SEC, attachPaidBagToCustomer,
  createPaidBagResourceLedger, disposePaidBagFromCustomer, syncPaidBagCarry,
} from './clubhouse/customerPaidBag.js';
import { activeFixtures, placedFixtures, ensureLayout, roomStyle } from '../sim/layout.js';
import { ROOM_STYLE_OPTIONS } from '../data/placeableCatalog.js';
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

// Goal 24 performance QA observes this edge without owning it. The callback is
// intentionally optional and synchronous: a recorder can move its measurement
// boundary onto the exact production frame that accepted an organic arrival,
// before customer construction and navigation begin. Observer failures are
// isolated so installing diagnostics can never change whether a shopper spawns.
export function emitGoal24NpcLifecycleBoundary(boundary) {
  const observer = globalThis.__goal24NpcLifecycleBoundary;
  if (typeof observer !== 'function') return false;
  try {
    observer(boundary);
    return true;
  } catch {
    return false;
  }
}

// The overlay layer the carried-delivery preview renders on. Exported so a
// check that something is DISTINCT from it can read it instead of retyping 30.
export const CARRY_RENDER_LAYER = 30;

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
// Every clubhouse ever constructed in this session, oldest first. See the note
// at the push site in makeClubhouse. Never cleared: a rebuild that happened and
// was then corrected is the whole thing this is here to catch.
// G2 — IS THE PROGRESS TEST WORTH ITS KEEP?
//
// Item 14 added a second stuck test beside the original displacement one, on
// this reasoning: walk into a CORNER and you move nothing, so `moved < step *
// 0.25` fires; walk into the flat FACE of a box and resolveCustomer slides you
// along it, so you move most of your step every frame, forever, and
// displacement is never true. The shape of the prop decided whether the
// recovery ladder existed at all.
//
// Report 14 could not confirm the branch had ever RESCUED anybody — the
// no-progress clock peaked at 1.66 s against a 2.5 s threshold — so the brief
// asks for proof or a revert. The verdict is a pure function so the proof does
// not depend on catching the sim in the act: tests/nav-stuck-verdict.test.js
// drives an input where displacement says "walking fine" and progress says
// "stuck", which is the whole claim, and the live diagnostics report the
// high-water mark so the threshold can be argued about with a number.
export const NAV_PROGRESS_EPSILON_YD = 0.08;
// G10 (Goal 17) asked for three seconds; F2 (Goal 18) tightens it to ONE:
// "New threshold: 1 second of no progress. Then they take a genuinely
// different route, even a much longer one." The live ladder must also act
// promptly — the old arithmetic stacked 3 s of no-progress plus 3 s of
// ladder gate, which is the six silent seconds the playtest watched.
export const NAV_NO_PROGRESS_SECONDS = 1;
// Kept as an alias so nothing that imported the old name breaks silently.
export const NAV_SLIDING_SECONDS = NAV_NO_PROGRESS_SECONDS;

/**
 * G2, ANSWERED AND REVERTED. The brief said: prove the progress test rescues
 * something displacement cannot, or revert it and record that displacement was
 * sufficient. It could not be proved, so it is reverted.
 *
 * Measured in Electron on pine-hills-v2, shop open, organic walk-ins, 150 s at
 * 1x (tools/qa/electron-nav-progress-peak.js). The no-progress clock reached
 * 3.00 s — PAST the 2.5 s threshold, so the branch was live and eligible — and
 * rescued exactly ZERO customers, while displacement caught four (two
 * sidesteps, a nudge, a retarget). Every frame on which progress would have
 * fired, displacement had already fired: the clock's high-water mark was set on
 * a frame that was also a displacement stall. The control run, with the
 * customer sim suspended, moved neither number.
 *
 * So `sliding` is no longer a stuck REASON. The clock and the counter stay,
 * because they cost nothing and they are the evidence that would reopen this:
 * `slidingRescues` counts the frames where progress WOULD have been the sole
 * signal, and it is still reported by navBlockDiagnostics(). If a future run
 * shows it climbing, the branch comes back with a number behind it instead of
 * an argument.
 *
 * @param {{moved:number, step:number, noProgressT:number}} sample
 * @returns {{stuck:boolean, reason:'none'|'displacement', wouldSlide:boolean}}
 */
export function navStuckVerdict({ moved, step, noProgressT }) {
  if (!(step > 0.001)) return { stuck: false, reason: 'none', wouldSlide: false };
  const wouldSlide = noProgressT > NAV_NO_PROGRESS_SECONDS;
  // G10 (Goal 17) — THREE SECONDS OF NO PROGRESS IS STUCK, WHATEVER
  // DISPLACEMENT THINKS, AND THIS ORDER IS THE WHOLE FIX.
  //
  // The previous attempt computed exactly this flag and then never let it make
  // anybody stuck: displacement was tested first and, as the measurement
  // showed, it had already fired on every frame where progress would have.
  // That is not evidence that no-progress is redundant - it is evidence that a
  // test which runs second can never win. The brief is explicit: "it must fire
  // regardless of what displacement thinks."
  //
  // So it is tested FIRST and carries its own reason, because the two need
  // different answers. Displacement means "you are against something" and a
  // sidestep usually clears it. No progress for three seconds means the route
  // itself is wrong, and the answer is a different route or a dropped stop.
  if (wouldSlide) return { stuck: true, reason: 'no-progress', wouldSlide };
  if (moved < step * 0.25) return { stuck: true, reason: 'displacement', wouldSlide };
  return { stuck: false, reason: 'none', wouldSlide };
}

export const CLUBHOUSE_BUILD_LOG = [];

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
  function presentRestorationFeedback(result) {
    if (!result?.ok || !Array.isArray(result.events)) return;
    for (const event of result.events) {
      if (event.type === 'audio' && hooks.sfx) hooks.sfx(event.cue);
      if (event.type === 'toast' && hooks.toast) hooks.toast(event.text, event.tone);
    }
  }
  // Course resources already resident when this clubhouse is built can be
  // referenced by its Object3D tree, but remain owned by the course. Everything
  // new beneath the clubhouse roots is released on a structure rebuild.
  const protectedRenderableResources = collectRenderableResources([scene, camera]);
  const baseY = heightAt(center.x, center.z);
  const floorY = baseY + FLOOR_TOP;
  const requestedClubhousePresentation = (() => {
    // pine-hills-v2 (the Phase 3 greybox, FLOOR_PLAN.md) exists only when the layout
    // seam resolved it at module load: shopLayout derived every datum from that same
    // constant, so accepting the variant from anywhere else (e.g. a saved property
    // field) would draw the v2 room over v1 coordinates. A save-only request degrades
    // to the v1 room — the datums it was built against.
    if (CLUBHOUSE_LAYOUT_VARIANT === 'pine-hills-v2') return 'pine-hills-v2';
    // The same resolution shopLayout already performed, not a second read of the
    // query: query, launch flag and persisted dev setting all reach the room the same
    // way, and a presentation that re-derived only one of them would silently ignore
    // the other two.
    const requested = CLUBHOUSE_VARIANT_REQUEST.variant || state?.property?.clubhouseVariant;
    if (requested === 'pine-hills-v2') return 'pine-hills';
    if (requested === 'mountain-lodge' || requested === 'legacy' || requested === 'pine-hills' || requested === 'shed') {
      return requested;
    }
    return 'modern-public';
  })();
  // The pine-hills-v2 greybox: authored FURNITURE stays off while every functional
  // asset keeps mounting — the cleaning suite 71-80 plus its socket parent 65, the
  // office/stockroom wing, the safety lights, the entrance mat. The v2 interior
  // module stands grey volumes in for what is vetoed here. Veto-only: the built-in
  // facility/fixture gates still apply to everything else.
  // A2 — EVERY BUILD, RECORDED, WITH WHAT IT RESOLVED AND WHY.
  //
  // The complaint is "tabbing out and back loads a DIFFERENT clubhouse first,
  // then mine", and the presentation switch above has a fallback to
  // 'modern-public' — a genuinely different building — reached whenever neither
  // the layout constant, the variant request, nor state.property.clubhouseVariant
  // names something known. A rebuild that happens before the save's property
  // field is populated would therefore draw the wrong building and then correct
  // itself, which is exactly what that sentence describes.
  //
  // So the answer must not be reasoned about. Every construction appends here,
  // with the three inputs it saw, and a driver can read the whole session's
  // history: one entry means one building was ever built.
  CLUBHOUSE_BUILD_LOG.push({
    at: CLUBHOUSE_BUILD_LOG.length,
    presentation: requestedClubhousePresentation,
    layoutVariant: CLUBHOUSE_LAYOUT_VARIANT,
    requested: CLUBHOUSE_VARIANT_REQUEST.variant || null,
    fromSavedProperty: state?.property?.clubhouseVariant || null,
  });
  // ...and if it ever DOES change under the player, say so out loud. A silent
  // swap is the reason this is hard to chase: the building is correct by the
  // time anyone looks. This turns "I think I saw a different clubhouse" into a
  // line in the console naming both of them.
  const firstBuild = CLUBHOUSE_BUILD_LOG[0];
  if (firstBuild.presentation !== requestedClubhousePresentation) {
    console.warn(
      `[clubhouse] presentation CHANGED mid-session: ${firstBuild.presentation} -> ${requestedClubhousePresentation}. `
      + `layout=${CLUBHOUSE_LAYOUT_VARIANT} requested=${CLUBHOUSE_VARIANT_REQUEST.variant} `
      + `savedProperty=${state?.property?.clubhouseVariant}. The player saw two different buildings.`,
    );
  }
  const greyboxPresentation = requestedClubhousePresentation === 'pine-hills-v2';
  const GREYBOX_SUPPRESSED_PROP_ASSETS = new Set([
    61, 62, 63,        // desk shell, hutch cabinet, fitting booth — grey volumes instead
    67, 68, 69, 70,    // lounge suite — grey volumes instead
    85, 88, 89, 90,    // counter-top dressing (phone, key rack, clipboard, scorecards)
    91, 93, 96, 98, 99, // wall/entrance dressing (safety board, camera, bulletin, sanitiser, umbrella stand)
  ]);
  // The stage-1 maintenance-shed test scene substitutes a small real room for
  // the clubhouse and suppresses all clubhouse dressing. Every shed branch in
  // this file gates on this single boolean; normal boots are untouched.
  const shedPresentation = requestedClubhousePresentation === 'shed';
  const dormantPresentation = (kind) => Object.freeze({
    ready: Promise.resolve(Object.freeze({ lifecycle: 'dormant', kind })),
    update() {},
    root: () => null,
    roots: () => Object.freeze({}),
    diagnostics: () => Object.freeze({ lifecycle: 'dormant', status: 'dormant', kind }),
    dispose: () => Object.freeze({ alreadyDisposed: false, dormant: true, kind }),
  });

  const group = new THREE.Group();          // shell: walls, roof, porch — always visible
  group.name = 'LegacyClubhouseShellAndExterior';
  group.position.set(center.x, baseY, center.z);
  const interior = new THREE.Group();       // fixtures, stock, grime, decor — distance-gated
  interior.name = 'LegacyClubhouseInterior';
  interior.position.set(center.x, floorY, center.z);
  // Indoor contents sit under the roof — the sun cannot reach them, so casting
  // into the world sun-shadow map produces physically-wrong shadows AND bloats
  // the 10 Hz shadow bake (measured ~27% of it, 1300+ caster meshes). Contact
  // shadows still come from GTAO. Strip castShadow from everything added to the
  // interior; the building SHELL (group) keeps casting so the clubhouse still
  // shadows the course. Wrapping add() catches async-loaded kit models too.
  const _interiorAdd = interior.add.bind(interior);
  // Under the shed presentation, the interior root is the single funnel every
  // clubhouse dressing system (legacy fixtures, stock, decor, pine-hills assets,
  // async props 61-100, campaign markers) flows through — including kit models
  // that load long after boot. Any child whose name is not on the shed
  // whitelist is hidden on the way in (never skipped, never disposed) so the
  // real seeded shed simulation (debris + wet + future shed dirt) is all that
  // remains visible. `Shed*` is the substitute shell; the Debris*/WetFloor names
  // are the sim visuals; `ShedDirt*` is reserved for the Phase-3 grime plane.
  const SHED_INTERIOR_WHITELIST = ['Shed', 'DebrisGrit', 'DebrisLitter', 'WetFloor', 'ShedDirt'];
  let shedSuppressedNodes = 0;
  interior.add = (...objs) => {
    for (const object of objs) {
      suppressInteriorSunShadows(object);
      if (shedPresentation && object
        && !SHED_INTERIOR_WHITELIST.some((prefix) => (object.name || '').startsWith(prefix))) {
        object.visible = false;
        // Stateful clubhouse systems (register, checkout, office, customer
        // baskets) re-assert `.visible = true` on their own roots after we hide
        // them. Lock the flag to false so the suppression sticks without any
        // per-frame bookkeeping; a hidden root hides its whole subtree.
        try {
          Object.defineProperty(object, 'visible', {
            configurable: true, get() { return false; }, set() {},
          });
        } catch { /* non-configurable node: the plain hide above still holds */ }
        shedSuppressedNodes++;
      }
    }
    return _interiorAdd(...objs);
  };
  const custGroup = new THREE.Group();      // customers walk in WORLD space (they go outside)
  custGroup.name = 'ClubhouseCustomers';
  scene.add(group, interior, custGroup);

  const L2W = (lx, lz) => ({ x: center.x + lx, z: center.z + lz });
  const W2L = (wx, wz) => ({ x: wx - center.x, z: wz - center.z });
  const interiorHalfWidth = shedPresentation ? SHED_ROOM.w / 2 : INTERIOR.w / 2;
  const interiorHalfDepth = shedPresentation ? SHED_ROOM.d / 2 : INTERIOR.d / 2;
  const isInside = (wx, wz, axialMargin = 0) => pointInsideClubhouseInterior(
    wx, wz, center.x, center.z, interiorHalfWidth, interiorHalfDepth, axialMargin,
  );
  const onPorch = (wx, wz) => {
    if (shedPresentation) return false; // the shed has no porch geometry
    const l = W2L(wx, wz);
    return Math.abs(l.x + 0.55) < (SHELL.porchW || SHELL.w * 0.70) / 2
      && l.z >= INTERIOR.d / 2
      && l.z <= SHELL.d / 2 + SHELL.porchD;
  };
  const mountainSiteGroundYAt = (wx, wz) => {
    if (requestedClubhousePresentation !== 'mountain-lodge') return null;
    const local = W2L(wx, wz);
    const s = MOUNTAIN_LODGE_METERS_TO_YARDS;
    const insideRect = (cx, cz, width, depth) => (
      Math.abs(local.x - cx * s) <= width * s / 2
      && Math.abs(local.z - cz * s) <= depth * s / 2
    );
    // Blender's -Y lodge front becomes Three.js +Z. Values below describe the
    // authored walkable modules, not terrain guesses, so player feet meet the
    // porch, cart slab, service route, and course patio exactly.
    if (insideRect(0, 0, MOUNTAIN_LODGE_BUILDING_WIDTH_METERS,
      MOUNTAIN_LODGE_BUILDING_DEPTH_METERS)) return floorY;
    if (insideRect(-0.50, 8.3375, 18.0, 3.40)) return baseY + 0.27432 * s;
    if (insideRect(-14.10, 3.2375, 7.20, 6.60)) return baseY + 0.13 * s;
    if (insideRect(0, -9.2375, 15.50, 5.20)) return baseY + 0.1575 * s;
    if (insideRect(-0.73152, 14.0375, 2.35, 7.10)) return baseY + 0.0875 * s;
    if (insideRect(11.32, 0.75, 1.35, 10.76)) return baseY + 0.0875 * s;
    if (insideRect(15.60, -2.125, 6.88, 47.25)) return baseY + 0.055 * s;
    if (insideRect(13.95, -3.29184, 7.20, 7.00)) return baseY + 0.10 * s;
    return null;
  };
  const modernSiteGroundYAt = (wx, wz) => {
    if (requestedClubhousePresentation !== 'modern-public') return null;
    const local = W2L(wx, wz);
    const s = MODERN_CLUBHOUSE_METERS_TO_YARDS;
    const insideRect = (cx, cz, width, depth) => (
      Math.abs(local.x - cx * s) <= width * s / 2
      && Math.abs(local.z - cz * s) <= depth * s / 2
    );
    // Blender's authored -Y front becomes Three.js +Z after glTF Y-up export.
    if (insideRect(0, 30.10, 41.40, 38.40)) return baseY + 0.14 * s;
    if (insideRect(27.70, 43.20, 14.0, 11.6)) return baseY + 0.16 * s;
    if (insideRect(0, 8.10, MODERN_CLUBHOUSE_BUILDING_WIDTH_METERS + 2.40, 2.10)) return baseY + 0.16 * s;
    if (insideRect(MODERN_CLUBHOUSE_MAIN_DOOR_X_METERS, 11.20, 2.40, 4.10)) return baseY + 0.16 * s;
    if (insideRect(13.50, -0.15, 8.80, 8.00)) return baseY + 0.20 * s;
    if (insideRect(24.20, 3.70, 12.60, 8.00)) return baseY + 0.18 * s;
    if (insideRect(-3.85, -9.55, 10.80, 6.20)) return baseY + 0.14 * s;
    if (insideRect(MODERN_CLUBHOUSE_CART_BARN_X_METERS, -4.50, 12.0, 8.40)) return baseY + 0.18 * s;
    return null;
  };
  const resortSiteGroundYAt = (wx, wz) => {
    if (state.property?.tierId !== 'resortStyle') return null;
    const local = W2L(wx, wz);
    const s = RESORT_CLUBHOUSE_METERS_TO_YARDS;
    const originX = DOOR_MAIN.x - (-1.0 * s);
    const originZ = halfD - 7.92 * s;
    const insideAuthoredRect = (x, y, width, depth) => (
      Math.abs(local.x - (originX + x * s)) <= width * s / 2
      && Math.abs(local.z - (originZ - y * s)) <= depth * s / 2
    );
    if (insideAuthoredRect(0, 0, 24, 15.5)) return floorY;
    if (insideAuthoredRect(-0.4, -9.33, 20.8, 3.35)) return baseY + 0.20 * s;
    if (insideAuthoredRect(-0.6, -14.75, 22.0, 9.0)) return baseY + 0.14 * s;
    if (insideAuthoredRect(8.0, -15.75, 10.8, 7.3)) return baseY + 0.13 * s;
    if (insideAuthoredRect(14.8, -13.15, 8.2, 13.0)) return baseY + 0.12 * s;
    if (insideAuthoredRect(0, 11.75, 19.0, 8.0)) return baseY + 0.15 * s;
    return null;
  };
  const suppressesGroundCoverAt = (wx, wz) => (
    (requestedClubhousePresentation === 'modern-public'
      && (isInside(wx, wz, 0.45) || modernSiteGroundYAt(wx, wz) !== null))
    || (state.property?.tierId === 'premiumPrivate'
      && (isInside(wx, wz, 0.45) || premiumSiteGroundYAt(wx, wz) !== null))
    || (state.property?.tierId === 'resortStyle'
      && (isInside(wx, wz, 0.45) || resortSiteGroundYAt(wx, wz) !== null))
  );
  const premiumSiteGroundYAt = (wx, wz) => {
    if (state.property?.tierId !== 'premiumPrivate') return null;
    const local = W2L(wx, wz);
    const s = PREMIUM_COUNTRY_CLUB_METERS_TO_YARDS;
    const originX = DOOR_MAIN.x;
    const originZ = halfD - 5 * s;
    const insideAuthoredRect = (x, y, width, depth) => (
      Math.abs(local.x - (originX + x * s)) <= width * s / 2
      && Math.abs(local.z - (originZ - y * s)) <= depth * s / 2
    );
    if (insideAuthoredRect(0, 0, 32, 10)) return floorY;
    if (insideAuthoredRect(0, -14, 12, 14)) return baseY + 0.12 * s;
    if (insideAuthoredRect(0, -69, 12, 34)) return baseY + 0.12 * s;
    if (insideAuthoredRect(-35.5, -49, 29, 52)
      || insideAuthoredRect(35.5, -49, 29, 52)) return baseY + 0.12 * s;
    const circleDx = local.x - originX;
    const circleDz = local.z - (originZ + 34 * s);
    if (Math.hypot(circleDx, circleDz) <= 19.5 * s) return baseY + 0.12 * s;
    if (insideAuthoredRect(7, 11.5, 18, 10)) return baseY + 0.18 * s;
    if (insideAuthoredRect(-21, 14, 26, 11)) return baseY + 0.16 * s;
    if (insideAuthoredRect(10, 18, 16, 16)
      || insideAuthoredRect(-14, 9, 10, 8)) return baseY + 0.14 * s;
    if (insideAuthoredRect(-21, 1, 2, 10)) return baseY + 0.14 * s;
    if (insideAuthoredRect(0, -9, 32, 4)) return baseY + 0.16 * s;
    if (insideAuthoredRect(-18, 5, 4, 20)
      || insideAuthoredRect(18, 5, 4, 20)) return baseY + 0.16 * s;
    return null;
  };
  const legacyGroundYAt = (wx, wz) => {
    if (isInside(wx, wz) || onPorch(wx, wz)) return floorY;
    return premiumSiteGroundYAt(wx, wz)
      ?? resortSiteGroundYAt(wx, wz)
      ?? mountainSiteGroundYAt(wx, wz)
      ?? modernSiteGroundYAt(wx, wz);
  };

  // every collider registers in BOTH the player's shared list and the local
  // customer list; dynamic ones (doors, clutter, decor) toggle through these
  const custCols = [];
  const registeredProps = [];
  const registeredCols = [];
  let colVersion = 0; // customers' nav grid rebakes when the collider world changes
  let shedShellPhase = false;
  // Same allow-gate as shedShellPhase, opened only while createShedInterior runs
  // so the shed's OWN furniture colliders + station/pizza props register while
  // every other clubhouse collider/prop stays rejected (Task-5 trap #2). Named
  // separately from the shell phase so the two build stages read distinctly.
  let shedInteriorPhase = false;
  function addCol(col) {
    // Under shed, only the substitute shell's own wall colliders (shedShellPhase)
    // and the shed interior's own furniture colliders (shedInteriorPhase) register.
    // Every other clubhouse collider — counter, register, office, fittings,
    // delivery — is rejected so no invisible obstacle survives inside the small
    // room. The caller still gets its handle back, so a later removeCol stays a
    // harmless no-op.
    if (shedPresentation && !shedShellPhase && !shedInteriorPhase) return col;
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
    // Under shed, reject any clubhouse interaction prop the walled-in player could
    // reach from inside the small room (front desk, laptop, office phone, cleaning
    // bay, box-carry helper …). None belong to a maintenance shed. The shed's OWN
    // stations + pizza-box register during shedInteriorPhase (trap #2); everything
    // else stays rejected. The caller still gets its handle back, so a later
    // removeProp stays a harmless no-op.
    if (shedPresentation && p && !shedInteriorPhase) {
      const reach = (Number(p.r) || 0) + 0.5;
      if (Math.abs(p.x - center.x) < SHED_ROOM.w / 2 + reach
        && Math.abs(p.z - center.z) < SHED_ROOM.d / 2 + reach) {
        return p;
      }
    }
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
  // Resolve only after createMerch has synchronously run every registered ready callback. The
  // authored runtime can then retire fallbacks without a late kit callback adding a duplicate.
  const merchReady = new Promise((resolve) => merch.onReady(resolve));
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

  let customerView = null;
  const B = {
    ctx, state, group, interior, custGroup, mats, merch, hooks, walk, camera, renderer,
    addCol, removeCol, addProp, removeProp, colBoxAt, L2W, W2L, FLOOR_TOP,
    presentRestorationFeedback,
    getCustomers: () => customerView?.actors || [],
  };
  let shell;
  if (shedPresentation) shedShellPhase = true;
  try {
    shell = shedPresentation ? buildShedShell(B) : buildShell(B);
  } finally {
    if (shedPresentation) shedShellPhase = false;
  }
  // Pine Hills' approved lighting contract is the eight authored rectangular
  // ceiling panels on every renderer.  Point proxies double the named rig,
  // flatten the broad panel falloff, and invalidate the repair/fault evidence.
  const lightingCompatibility = Object.freeze({
    backend: 'rect-area',
    maxTextureImageUnits: Number(renderer?.capabilities?.maxTextures || 0),
    replacementCount: 0,
  });
  shell.lightingCompatibility = lightingCompatibility;

  // --- OPEN / CLOSED, IN ONE PLACE -------------------------------------------
  // Two signs, one fact. Every board that says OPEN or CLOSED registers here and
  // is repainted by syncOpenClosedSigns(), which reads signIsOpen(state) and
  // nothing else. A sign that is not registered is driven by nothing, and
  // tests/shop-sign.test.js checks the registered names against the scene.
  const openClosedSigns = createOpenClosedSignRegistry();
  if (shell.exteriorSignName && shell.setSignFace) {
    openClosedSigns.register(shell.exteriorSignName, (facts) => {
      shell.setSignFace(exteriorSignFace(facts));
    });
  }
  function syncOpenClosedSigns() {
    return openClosedSigns.sync(state, campaignAllowsBusiness(state));
  }

  function refreshRoomStyle() {
    const selected = roomStyle(state);
    for (const kind of ['floor', 'walls', 'trim']) {
      const material = shell.styleSurfaces?.[kind];
      const option = ROOM_STYLE_OPTIONS[kind]?.find((entry) => entry.id === selected[kind]);
      if (!material || !option) continue;
      material.color.setHex(option.color);
      if (Number.isFinite(option.roughness)) material.roughness = option.roughness;
      material.needsUpdate = true;
    }
  }
  refreshRoomStyle();

  // --- grime + window film (clubhouse/dirt.js — art-directed, state-masked) --------------
  B.onWindowDirt = () => shell.lighting.setWindowDirt(windowDirtAvg(state));
  // The shed paints its OWN art-directed grime plane (sized to the 8x6 room, not
  // the 17.9x11 clubhouse floor that would poke through the shed walls) plus a
  // wipeable film per shed window. It registers NO window [E]-wipe props — the
  // shed's windows are tool-cleaning targets, driven by shedInterior. The legacy
  // buildDirt stays the default clubhouse detailer.
  const dirt = shedPresentation
    ? buildShedDirt(B, shell.windowDefs)
    : buildDirt(B, shell.windowDefs);
  const repaintGrime = dirt.repaintGrime;
  B.onWindowDirt();

  // Welcome mat inside the door.
  let fallbackWelcomeMat = null;
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
    fallbackWelcomeMat = matMesh;
  }

  // --- doors + interior lighting (clubhouse/doors.js + the shell rig) --------------------
  const doorsApi = buildDoors(B, { dormant: shedPresentation });
  const doors = doorsApi.doors;
  const updateDoors = doorsApi.updateDoors;
  const architecturalDoorInstallation = createClubhouseArchitecturalDoorInstallation({
    group,
    state,
    doorApi: doorsApi,
    floorTop: FLOOR_TOP,
    halfWidth: halfW,
    halfDepth: halfD,
    camera,
    // The authored Course-1 entrance owns the pine-hills front door — in both
    // rooms; the v2 greybox changes fixtures, never the entrance systems.
    replaceMainEntrance: requestedClubhousePresentation !== 'pine-hills'
      && requestedClubhousePresentation !== 'pine-hills-v2',
  });
  const sheet06Production = createSheet06ProductionRuntime({
    group,
    interior,
    state,
    shellFallbacks: shell.productionVisualFallbacks,
    doorApi: doorsApi,
    navigationApi: sheet06Navigation,
  });
  const mountainLodge = requestedClubhousePresentation === 'mountain-lodge'
    ? createMountainLodge({
      group,
      shellFallbacks: shell.productionVisualFallbacks,
      sheet06Production,
      doors,
      getMinuteOfDay: () => state.clock.minutes % 1440,
    })
    : dormantPresentation('mountain-lodge');
  // Assets 71-100: thirty finished props that nothing was loading. Static dressing, so they skip
  // the Sheet 6 production machinery entirely and just get placed — each aligned by its own
  // SOCKET_PLACEMENT rather than by its authoring origin.
  const sheet06ProductionPublic = Object.freeze({
    ready: sheet06Production.ready,
    diagnostics: () => sheet06Production.diagnostics(),
    getRoot: (number) => sheet06Production.getRoot(number),
    getAssemblyRoot: (number) => sheet06Production.getAssemblyRoot(number),
  });
  const modernClubhouse = requestedClubhousePresentation === 'modern-public'
    && !['resortStyle', 'premiumPrivate'].includes(state.property?.tierId)
    ? createModernPublicClubhouse({
      group,
      legacyInterior: interior,
      sheet06: sheet06ProductionPublic,
      shellFallbacks: shell.productionVisualFallbacks,
      legacyPartitionColliders: shell.partitionColliders,
      doors,
      doorApi: doorsApi,
      addCollider: addCol,
      removeCollider: removeCol,
      colBoxAt,
      replacementDoorPresentation: true,
    })
    : dormantPresentation('modern-public');
  let props61to100 = null;
  let props61to100ProtectedAtDisposal = null;
  let deliveryEquipment = null;
  const resortClubhouse = createResortClubhouse({
    group,
    legacyInterior: interior,
    shellFallbacks: shell.productionVisualFallbacks,
    sheet06Production,
    doors,
    enabled: state.property?.tierId === 'resortStyle',
    floorTop: FLOOR_TOP,
    facadeDoorZ: halfD,
    entranceCenterX: DOOR_MAIN.x,
    competingRoots: [
      () => mountainLodge.root(),
      () => modernClubhouse.roots(),
    ],
    addCollider: addCol,
    removeCollider: removeCol,
    colBoxAt,
  });
  // These legacy dressing systems initialize later in the build. The premium
  // presentation evaluates the callbacks only after its GLB is ready, so async
  // additions remain suppressed without transferring resource ownership.
  const premiumCountryClub = createPremiumCountryClub({
    group,
    legacyInterior: interior,
    shellFallbacks: shell.productionVisualFallbacks,
    sheet06Production,
    doors,
    enabled: state.property?.tierId === 'premiumPrivate',
    floorTop: FLOOR_TOP,
    facadeDoorZ: halfD,
    entranceCenterX: DOOR_MAIN.x,
    addCollider: addCol,
    removeCollider: removeCol,
    colBoxAt,
    competingRoots: [
      () => mountainLodge.root(),
      () => modernClubhouse.roots(),
      () => resortClubhouse.root(),
      () => props61to100?.roots?.(),
      () => [deliveryEquipment?.interiorRoot, deliveryEquipment?.exteriorRoot],
      () => ctx.extraMeshes,
    ],
  });
  // The shed has no exterior yard: buildExterior registers weed/gutter/paint [E]
  // repair verbs on the clubhouse facade, all nonsense in the shed. Washing is
  // still built (its API is consumed everywhere) but the recipe zeroed wash
  // grime, so its surfaces render fully transparent and it owns no [E] prompts.
  if (!shedPresentation) buildExterior(B); // yard neglect + physical repair verbs (clubhouse/exterior.js)
  const washing = buildWashing(B); // exterior grime: a mask you erode with the jet, not an [E] verb
  scene.add(washing.jet, washing.mist);

  let conditionNow = 100;
  function refreshEntranceMatAppearance() {
    const matRoot = props61to100?.getRoot(100);
    if (!matRoot) return;
    const cleanliness = state.campaign?.enabled ? campaignZoneProgress(state).entrance : conditionNow / 100;
    const soil = 1 - Math.max(0, Math.min(1, cleanliness));
    matRoot.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material?.color) continue;
        if (!material.userData.campaignMatBase) {
          material.userData.campaignMatBase = `#${material.color.getHexString()}`;
        }
        material.color.set(material.userData.campaignMatBase).lerp(new THREE.Color(0x2d261d), soil * 0.72);
        material.needsUpdate = true;
      }
    });
  }
  function refreshCondition() {
    conditionNow = state && state.shop ? shopCondition(state) : 100;
    shell.lighting.refreshCondition(conditionNow);
    refreshEntranceMatAppearance();
  }
  const ceilingCircuitRenderSync = createCeilingCircuitRenderSync({
    state,
    readPowered: ceilingCircuitPoweredSim,
    applyPowered: (powered) => shell.lighting.setCeilingCircuitPowered(powered),
  });
  const syncCeilingCircuitPower = () => ceilingCircuitRenderSync.sync();
  const updateFlicker = (dt) => {
    // Shared with the sim's repair-light gate — see clubhouseRestoration.js.
    // When the renderer owned its own copy of this rule, the sim could report a
    // panel repaired while this side kept the ring dark.
    syncCeilingCircuitPower();
    shell.lighting.updateFlicker(dt);
  };

  // --- fixtures, lounge, stockroom dressing (clubhouse/fixtures.js) ----------------------
  B.rebuildStock = (...a) => rebuildStock(...a); // function is hoisted; wired before use
  const {
    fixtureAnchors,
    relayFixtures,
    setFixtureCollidersActive,
    fixtureColliderDiagnostics,
    refreshTierDressing,
    update: updateFixtures,
    dispose: disposeFixtures,
  } = buildFixtures(B);

  // Asset 63 uses the same analytic-navigation contract as every other clubhouse fixture, but a
  // fitting booth is not a solid square. Register its rear/side walls and bench separately so the
  // authored east-facing curtain remains a real entrance. Only the thin curtain collider toggles.
  const fittingRecord = RUNTIME_ASSET_MANIFEST_BY_NUMBER[63];
  const fittingPlacement = fittingRecord.placement;
  const fittingSize = fittingRecord.binding.dimensionsMeters.width
    * fittingRecord.binding.runtimeScale;
  const fittingHalf = fittingSize / 2;
  const fittingWall = 0.13;
  const fittingRoomColliders = [
    colBoxAt(
      fittingPlacement.x - fittingHalf + fittingWall / 2,
      fittingPlacement.z,
      fittingWall,
      fittingSize,
    ),
    colBoxAt(
      fittingPlacement.x,
      fittingPlacement.z - fittingHalf + fittingWall / 2,
      fittingSize,
      fittingWall,
    ),
    colBoxAt(
      fittingPlacement.x,
      fittingPlacement.z + fittingHalf - fittingWall / 2,
      fittingSize,
      fittingWall,
    ),
    colBoxAt(fittingPlacement.x - 0.47, fittingPlacement.z, 0.42, 0.92),
  ];
  const fittingCurtainCollider = colBoxAt(
    fittingPlacement.x + fittingHalf - fittingWall / 2,
    fittingPlacement.z,
    fittingWall,
    fittingSize - 0.12,
  );
  let fittingStructuralCollidersActive = false;
  let fittingCurtainColliderActive = false;
  function setFittingRoomInstalled(installed) {
    if (installed && !fittingStructuralCollidersActive) {
      fittingRoomColliders.forEach(addCol);
      fittingStructuralCollidersActive = true;
    } else if (!installed && fittingStructuralCollidersActive) {
      fittingRoomColliders.forEach(removeCol);
      fittingStructuralCollidersActive = false;
    }
    setFittingCurtainOpen(state.shop?.assetRuntime?.asset_063?.open === true);
  }
  function setFittingCurtainOpen(open) {
    const shouldBlock = fixtureIsInstalled(state, 'fittingroom') && !open;
    if (!shouldBlock && fittingCurtainColliderActive) {
      removeCol(fittingCurtainCollider);
      fittingCurtainColliderActive = false;
    } else if (shouldBlock && !fittingCurtainColliderActive) {
      addCol(fittingCurtainCollider);
      fittingCurtainColliderActive = true;
    }
  }
  setFittingRoomInstalled(fixtureIsInstalled(state, 'fittingroom'));

  // THE RESIZE WALLS (pine-hills-v2, OVERNIGHT_REPORT.md §3): the 70 m² public
  // envelope's new west and north walls. Builder-owned colliders exactly like
  // every other wall — the greybox module draws the matching grey slabs but
  // registers nothing. The walls meet at the NW corner; the service wing east of
  // the partition keeps the original shell.
  if (greyboxPresentation) {
    const bounds = PINE_HILLS_V2_LAYOUT.publicBounds;
    const wallT = PINE_HILLS_V2_LAYOUT.wallT;
    addCol(colBoxAt(
      bounds.minX - wallT / 2,
      (bounds.minZ - wallT + bounds.maxZ) / 2,
      wallT,
      bounds.maxZ - (bounds.minZ - wallT),
    ));
    addCol(colBoxAt(
      (bounds.minX - wallT + bounds.maxX) / 2,
      bounds.minZ - wallT / 2,
      bounds.maxX - (bounds.minX - wallT),
      wallT,
    ));
    // The corridor seal: the partition-to-desk stub the approved drawing shows
    // and the build never placed (see the layout's corridorSeal note).
    const seal = PINE_HILLS_V2_LAYOUT.corridorSeal;
    addCol(colBoxAt(
      seal.x,
      (seal.zFrom + seal.zTo) / 2,
      seal.t,
      seal.zTo - seal.zFrom,
    ));
    // The west seal: both fillets of the Z-channel behind the return (see the
    // layout's corridorWestSeal note).
    for (const rect of Object.values(PINE_HILLS_V2_LAYOUT.corridorWestSeal)) {
      addCol(colBoxAt(
        (rect.minX + rect.maxX) / 2,
        (rect.minZ + rect.maxZ) / 2,
        rect.maxX - rect.minX,
        rect.maxZ - rect.minZ,
      ));
    }
  }

  props61to100 = buildProps({
    interior,
    loader: new GLTFLoader(),
    state,
    addProp,
    removeProp,
    // PROP_PLACEMENTS declares who owns each asset's collider; until these were
    // threaded through, nothing read that field and every declared hull was
    // inert (propPlacement.collisionIsOwnedElsewhere).
    addCol,
    removeCol,
    L2W,
    getFixtureAnchor: (fixtureId) => fixtureAnchors.get(fixtureId) || null,
    legacyReady: merchReady,
    merch,
    // Sheet-6 and other loader runtimes can share GLTF resource identities in
    // tests and through future cache unification. The course/scene resources
    // that predate this runtime remain borrowed, never runtime-owned.
    protectedRenderableResources: () => props61to100ProtectedAtDisposal
      || mergeRenderableResources(
        protectedRenderableResources,
        sheet06Production.borrowedResources?.(),
        architecturalDoorInstallation.ownedResources?.(),
      ),
    // This suppression set is a construction-time presentation choice. Declaring
    // it fixed lets the three allowed inert props share the global static batch;
    // genuinely mutable visibility callbacks remain conservatively unbatched.
    fixedVisibilityForAsset: greyboxPresentation
      ? (assetNumber) => !GREYBOX_SUPPRESSED_PROP_ASSETS.has(assetNumber)
      : null,
    hooks: {
      ...hooks,
      assetStateChanged(change) {
        hooks?.assetStateChanged?.(change);
        if (change.assetNumber === 63 && change.state === 'open') {
          setFittingCurtainOpen(change.value === true);
        }
      },
    },
  });
  props61to100.ready.then(() => {
    if (interior.parent) refreshEntranceMatAppearance();
  });
  const syncBucketVisual = () => {
    const status = cleaningStatus(state);
    if (status) props61to100.setBucketWater(status.bucket);
  };
  props61to100.ready.then(syncBucketVisual);

  // The pine-hills interior is the clubhouse's default detailer (warm floor,
  // wainscot, boards, cooler, structural-repair [E] props, cleanup targets). It
  // is meaningless in the shed, so the module itself never constructs there —
  // this dormant stand-in satisfies the full consumed API as no-ops.
  const pineHillsInterior = shedPresentation ? {
    ready: Promise.resolve(null),
    refresh() {},
    applyCleaningTool: () => ({ handled: false }),
    detachFixturePlacements() {},
    syncFixturePlacements: () => false,
    update() {},
    getRoot: () => null,
    roots: () => [],
    diagnostics: () => ({
      dormant: true, expected: 0, loaded: 0, failed: 0, failures: [],
      coolerMounted: false, cleanupTargets: 0, interactions: 0, staticDressingBatch: null,
    }),
    dispose: () => ({ dormant: true }),
  } : (greyboxPresentation ? createPineHillsV2Interior : createPineHillsInterior)({
    interior,
    state,
    addProp,
    removeProp,
    addCol,
    L2W,
    getFixtureAnchor: (fixtureId) => fixtureAnchors.get(fixtureId) || null,
    getRuntimeAssetRoot: (assetNumber) => props61to100.getRoot(assetNumber),
    hooks,
    onRestoration(result) {
      presentRestorationFeedback(result);
      if (result?.type === 'repair-component' || result?.type === 'paint-component') {
        // Structural work changes the authored damaged/restored node pairs and
        // finish variants, which only the sheet06 runtime can re-apply.
        void sheet06Production.applyState(state);
        if (state.tutorial) {
          triggerContextTutorial(state, 'structural-repair');
          if (result.type === 'repair-component' && result.restored) {
            tutorialFlag(state, 'repairedComponent');
            triggerContextTutorial(state, 'refinish-paint');
          }
          if (result.type === 'paint-component' && result.changed) {
            tutorialFlag(state, 'paintedComponent');
          }
        }
      }
      shell.lighting.refreshRestoration?.();
      refreshCondition();
    },
    onStockSocketsReady() {
      if (!interior.parent) return;
      rebuildStock();
    },
  });
  Promise.all([props61to100.ready, pineHillsInterior.ready]).then(() => {
    if (interior.parent) pineHillsInterior.refresh();
  });
  // The discrete cleaning-target pre-gate (cleanWithTool) consults the detail
  // interior's own contact map before the floor gate. Under shed this is the shed
  // interior (furniture, the eleven targets, the two stations); the clubhouse
  // default is the pine-hills interior. shedInteriorPhase opens the addProp/addCol
  // gate around construction so the shed's own colliders + props register.
  let shedInterior = null;
  if (shedPresentation) {
    shedInteriorPhase = true;
    try {
      shedInterior = createShedInterior({
        interior,
        state,
        addProp,
        removeProp,
        addCol,
        colBoxAt,
        L2W,
        mats,
        hooks,
        presentRestorationFeedback,
        refreshFilms: dirt.refreshFilms,
      });
    } finally {
      shedInteriorPhase = false;
    }
  }
  const detailInterior = shedPresentation ? shedInterior : pineHillsInterior;
  // The loading-manager counter reaches zero before every loader callback has
  // necessarily finished mounting, canonicalizing, and batching its scene
  // nodes. Doorway prewarm must not certify those late nodes as resident before
  // every runtime capable of changing the first shop view has settled.
  // All loaders are already in flight, so this is one concurrent barrier rather
  // than a serial load chain.
  const firstDoorVisibilityReady = createFirstDoorVisibilityReady({
    sheet06: sheet06Production.ready,
    architecturalDoors: architecturalDoorInstallation.ready,
    props: props61to100.ready,
    pineHillsInterior: pineHillsInterior.ready,
    shedInterior: shedInterior?.ready ?? Promise.resolve(Object.freeze({
      lifecycle: 'dormant', kind: 'shed-interior',
    })),
    modernPublic: modernClubhouse.ready,
    mountainLodge: mountainLodge.ready,
    resortClubhouse: resortClubhouse.ready,
    premiumCountryClub: premiumCountryClub.ready,
    diagnostics: {
      sheet06: () => sheet06Production.diagnostics(),
      architecturalDoors: () => architecturalDoorInstallation.diagnostics(),
      props: () => props61to100.diagnostics(),
      pineHillsInterior: () => pineHillsInterior.diagnostics(),
      shedInterior: () => shedInterior?.diagnostics?.() ?? Object.freeze({
        lifecycle: 'dormant', status: 'dormant', kind: 'shed-interior',
      }),
      modernPublic: () => modernClubhouse.diagnostics(),
      mountainLodge: () => mountainLodge.diagnostics(),
      resortClubhouse: () => resortClubhouse.diagnostics(),
      premiumCountryClub: () => premiumCountryClub.diagnostics(),
    },
  });

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
  let placeableVisuals = null;
  let builder = null;
  function rebuildLayout() {
    props61to100.detachFixturePlacements();
    pineHillsInterior.detachFixturePlacements();
    relayFixtures();
    props61to100.syncFixturePlacements();
    pineHillsInterior.syncFixturePlacements();
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
  builder = buildBuildMode(B, {
    rebuildLayout,
    rebuildDecor: () => rebuildDecor(),
    fixtureAnchors,
    fixtureMoveBlocker,
    setFixtureStockVisible,
    setFixtureCollidersActive,
    fixtureColliderDiagnostics,
    createPlaceablePreview: (skuId) => createPlaceablePreview(skuId),
    setDecorPlacementVisible: (placementId, visible) => setDecorPlacementVisible(placementId, visible),
  });
  const shopProgressionVisuals = buildShopProgressionVisuals(B);
  const loungeInterior = new THREE.Group();
  loungeInterior.name = 'TieredMemberLounge';
  interior.add(loungeInterior);
  const loungeColliders = [];
  let loungeActive = false;
  buildLounge({
    ...B,
    interior: loungeInterior,
    addCol: (collider) => {
      loungeColliders.push(collider);
      if (loungeActive) addCol(collider);
      return collider;
    },
  });
  function syncTieredLounge() {
    const active = shopTierIndex(state) >= 2;
    loungeInterior.visible = active;
    if (active === loungeActive) return;
    loungeActive = active;
    for (const collider of loungeColliders) {
      if (active) addCol(collider);
      else removeCol(collider);
    }
  }
  syncTieredLounge();
  buildStockroomDressing(B);

  function refreshShopProgression() {
    shell.lighting.setShopTier();
    shopProgressionVisuals.refresh();
    syncTieredLounge();
    refreshTierDressing();
    props61to100.refreshVisibility();
    setFittingRoomInstalled(fixtureIsInstalled(state, 'fittingroom'));
    relayFixtures();
    retargetCustomerFixtureStops();
    rebuildStock();
    rebuildBoxes();
    return shopProgressionVisuals.diagnostics();
  }

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
  // The register's irreversible finalizer receives one authoritative route
  // bridge owned by the customer runtime. Unlike presentation callbacks stored
  // on an actor, this remains available if an actor callback is absent or was
  // replaced by a failing test/extension hook.
  B.releasePaidCustomerFromCheckoutAuthoritative = (customer) => (
    releasePaidCustomerFromCheckoutAuthoritative(customer)
  );
  const register = createRegisterMode(B);
  // QA-only, identity-bound and one-shot. The runtime checkout verifier uses
  // this to prove a presentation exception after durable banking cannot strand
  // the customer, duplicate the ticket, or return paid stock to inventory.
  let qaPaidPresentationFault = null;
  let qaPaidReleaseFault = null;
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

  function refreshCheckoutAvailability() {
    const counterReady = facilityInstalled(state, 'frontCounter');
    const hardwareReady = facilityInstalled(state, 'registerHardware');
    checkout.setAvailability({ counter: counterReady, hardware: hardwareReady });
    register.root.visible = hardwareReady;
  }
  refreshCheckoutAvailability();

  const regWp = L2W(REGISTER.scanner.x, REGISTER.scanner.z);

  const reviewIdOfCustomer = (c) => {
    const propertyId = state.property?.id || `club-${state.seed}`;
    const customerId = c?.customerId || c?.id
      || `visitor-seed-${Math.round(Number(c?.seed || 0) * 1_000_000_000)}`;
    return `${propertyId}:${customerId}:review`;
  };

  // what this customer's day was actually like — the only thing a review is allowed to read
  const visitOf = (c, bought) => ({
    reviewId: reviewIdOfCustomer(c),
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

  // Shopper-held products and patience indicators are made uniquely for that
  // shopper. Merchandise models, by contrast, are clones from the shared asset
  // cache and must never be disposed here.
  function disposeOwnedMesh(mesh) {
    if (!mesh) return;
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) if (material && material.dispose) material.dispose();
  }

  function removeCustomerItem(c) {
    if (!c.itemMesh) return;
    if (c.itemMesh.parent) c.itemMesh.parent.remove(c.itemMesh);
    c.itemMesh.traverse((node) => disposeOwnedMesh(node));
    c.itemMesh = null;
  }

  function ensureCustomerBasket(c) {
    if (c.basket) return c.basket;
    const basket = merch && merch.instantiate('basket');
    if (!basket) return null;
    basket.name = 'customer-basket';
    basket.scale.setScalar(0.66);
    basket.rotation.y = 0.08;
    basket.userData.checkout = false;
    const char = c.mesh.userData.char;
    if (char && char.carryAnchor) {
      char.carryAnchor.add(basket);
      // The authored pivot is the tub floor; lower it so the raised handle, not
      // the base, lands in the shopper's carrying hand.
      basket.position.set(-0.02, -0.24, 0.01);
      if (char.setCarrying) char.setCarrying(true);
    } else {
      c.mesh.add(basket);
      basket.position.set(0.28, 0.30, 0.10);
    }
    c.basket = basket;
    return basket;
  }

  function syncCustomerBasket(c) {
    removeCustomerItem(c);
    if (!c.cart.length) return;
    const basket = ensureCustomerBasket(c);
    if (!basket) return;
    const contents = new THREE.Group();
    contents.name = 'basket-contents';
    c.cart.slice(0, 3).forEach((entry, i) => {
      const sku = SHOP_CATALOG.find((s) => s.id === entry.skuId);
      const item = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.09, 0.11),
        new THREE.MeshStandardMaterial({
          color: CAT_COLORS[sku ? sku.cat : 'accessories'] || 0x999999,
          roughness: 0.72,
        }),
      );
      item.position.set((i % 2 ? 1 : -1) * 0.075, 0.175 + Math.floor(i / 2) * 0.055, (i % 3 - 1) * 0.035);
      item.rotation.y = i % 2 ? 0.18 : -0.14;
      item.castShadow = true;
      contents.add(item);
    });
    basket.add(contents);
    c.itemMesh = contents;
  }

  function placeCustomerBasket(c) {
    if (!c.basket) return;
    removeCustomerItem(c); // the transaction goods now travel onto the staging mat
    interior.attach(c.basket);
    const basketRest = frontDeskPoint(1.88, -0.30);
    c.basket.position.set(basketRest.x, COUNTER_TOP + 0.012, basketRest.z);
    c.basket.rotation.set(0, COUNTER.ry - 0.10, 0);
    c.basket.userData.checkout = true;
  }

  function removeCustomerBasket(c) {
    removeCustomerItem(c);
    if (!c.basket) return;
    if (c.basket.parent) c.basket.parent.remove(c.basket);
    c.basket = null;
    const char = c.mesh && c.mesh.userData.char;
    if (char && char.setCarrying && !c.carryBag) char.setCarrying(false);
  }

  // the head of the queue, with goods, waiting on YOU
  const headForCheckout = () => {
    const c = counterQueue[0];
    return c && c.cart && c.cart.length && c.awaitingCheckout ? c : null;
  };

  function attachOversizePurchaseVisuals(c, transaction) {
    const handedProducts = Array.isArray(c.checkoutHandoffOversizeProducts)
      ? c.checkoutHandoffOversizeProducts.filter((product) => product?.isObject3D)
      : [];
    c.checkoutHandoffOversizeProducts = [];
    const oversize = (transaction && transaction.items ? transaction.items : [])
      .map((item) => ({ item, sku: SHOP_CATALOG.find((sku) => sku.id === item.skuId) }))
      .filter(({ sku }) => catalogProductVisual(sku).separateHandoff);
    if (!handedProducts.length && !oversize.length) return null;
    const carry = new THREE.Group();
    carry.name = 'PaidOversizeCarryRoot';
    c.mesh.add(carry);
    c.oversizeCarryRoot = carry;
    const products = handedProducts.length
      ? handedProducts.map((product) => ({
        item: { uid: product.userData.uid || product.userData.checkoutUid },
        product,
      }))
      : oversize.map(({ item, sku }) => {
        const built = buildCatalogProductProxy({
          sku,
          merch,
          mats,
          resources: c.checkoutProductResources,
        });
        return { item, product: built.root };
      });
    products.forEach(({ item, product }, index) => {
      // Checkout models rest along X. Turn them upright along the customer's free
      // side for departure; unlike the paper carrier they remain full-scale.
      carry.add(product);
      product.position.set(-0.30 - index * 0.08, 1.24 + index * 0.05, 0.12 - index * 0.06);
      product.rotation.set(0, -0.10 + index * 0.08, -Math.PI / 2);
      product.userData.checkoutOwner = 'customer';
      product.userData.checkoutUid = item.uid;
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

  function transferCustomerPaidOwnership(c) {
    if (!c) return false;
    const firstTransfer = !c.bought;
    c.bought = true;
    c.paymentStatus = 'paid';
    // The ticket is already durable when this callback runs. Transfer the
    // merchandise ownership before review, meshes, audio, or handoff visuals:
    // none of those presentation steps may leave a paid cart eligible for the
    // unpaid-exit restock net if one of them fails.
    c.cart = [];
    c.awaitingCheckout = false;
    c.checkoutPhase = 'complete';
    // Operational tallies belong beside authoritative paid ownership, not in
    // fallible review/mesh/bag presentation. Customer history itself is banked
    // synchronously by completeSale so both survive an onPaid exception.
    if (firstTransfer) {
      visitTally.purchasesCompleted += 1;
      if (c.combinedVisit) visitTally.combinedCompleted += 1;
    }
    // Do not let actor presentation claim an accounting result the durable
    // ticket did not achieve. The register sets this only after its persisted
    // customer-visit event applied (or reconciled as an idempotent no-op).
    c.visitRecorded = c.tx?.customerVisitRecorded === true;
    return true;
  }

  function releasePaidCustomerFromCheckoutAuthoritative(c) {
    if (!c) return false;
    // This is the non-visual, idempotent last-resort boundary used from the
    // register finalizer's `finally`. Keep it independent of shelf rebuilds,
    // reviews, meshes, audio, and every other operation that can throw after a
    // ticket has banked. Even if leaveQueue itself is later decorated with a
    // fallible side effect, exact-identity removal below still frees the till.
    try {
      leaveQueue(c);
    } catch {
      const queueIndex = counterQueue.indexOf(c);
      if (queueIndex >= 0) counterQueue.splice(queueIndex, 1);
      c.queued = false;
      c.queueSlotHeld = null;
    }
    const exitIdx = c.stops?.findIndex((stop) => stop.kind === 'exit') ?? -1;
    if (exitIdx >= 0) c.stopIdx = exitIdx;
    c.linger = 0;
    c.currentDestination = 'exit';
    c.path = null;
    c.pathGoal = null;
    c.checkoutPaidReleased = true;
    return counterQueue.indexOf(c) < 0;
  }

  function releasePaidCustomerFromCheckout(c, transaction = null) {
    const injectedFault = qaPaidReleaseFault;
    qaPaidReleaseFault = null;
    if (injectedFault
        && Number(injectedFault.transactionNumber) === Number(transaction?.number)
        && String(injectedFault.customerId) === String(c?.customerId)) {
      throw new Error('QA injected paid-customer route-release failure.');
    }
    const released = releasePaidCustomerFromCheckoutAuthoritative(c);
    if (!released) return false;
    // Reconcile the shelf even if the decorative paid-customer presentation
    // failed before it reached its old rebuild call. The ownership and route
    // fields above remain authoritative if this visual refresh itself throws.
    rebuildStock();
    return true;
  }

  // The sale banked. registerMode calls this through cust.onPaid, because IT owns the
  // money and the goods, and clubhouse.js owns the person. Authoritative ownership
  // and route release are separate callbacks so a broken review/mesh/bag flourish
  // cannot strand an already-durable ticket at the register.
  function onCustomerPaid(c, transaction = null) {
    transferCustomerPaidOwnership(c);
    const injectedFault = qaPaidPresentationFault;
    qaPaidPresentationFault = null;
    if (injectedFault
        && Number(injectedFault.transactionNumber) === Number(transaction?.number)
        && String(injectedFault.customerId) === String(c?.customerId)) {
      throw new Error('QA injected paid-customer presentation failure.');
    }
    const acceptanceYaw = c.mesh.rotation.y;
    leaveReview(c, true);
    clearCustomerItemMeshes(c);
    // the goods are paid for; if they also came for the course, THIS is where
    // they raise it - after everything is scanned, at the same counter
    beginPendingDesk(c);
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
      const ownedBagResources = createPaidBagResourceLedger();
      const body = new THREE.Mesh(
        ownedBagResources.ownGeometry(new THREE.BoxGeometry(0.2, 0.26, 0.13)),
        ownedBagResources.ownMaterial(new THREE.MeshStandardMaterial({
          color: 0x2e5a3a, roughness: 0.85,
        })),
      );
      body.position.y = 0.13;
      bag.add(body);
      bag.userData.disposeCheckoutPaidBagResources = () => ownedBagResources.dispose();
      bag.userData.checkoutPaidBagResourceStatus = () => ownedBagResources.status();
    } else if (legacyBag) {
      // A believable 26 cm retail carrier: large enough for the three-item sale
      // and readable as the object the customer owns in the departure shot.
      bag.scale.setScalar(0.78);
    }
    // No receipt rides in the bag: round 7 removed the receipt from the whole
    // checkout ("please completely remove the receipt") — the sim's paperwork
    // is filed silently and the customer walks out with goods only.
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
  }

  addProp({
    x: regWp.x, z: regWp.z, r: 2.2,
    // F1 (Full_Goal_16): a work station — its prompt outranks an equipped
    // tool's label inside this radius (courseScene walkFindFocus).
    station: true,
    label: () => {
      if (!facilityInstalled(state, 'frontCounter')) return null;
      if (!facilityInstalled(state, 'registerHardware')) {
        return 'Front desk - install and confirm the register hardware first';
      }
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
        const reservation = due[0];
        return `Tee desk - [E] serve ${reservation.reservationHolder} (${reservation.partySize} players · ${fmtSlot(reservation.minute)})`
          + (due.length > 1 ? ` · ${due.length - 1} more waiting` : '');
      }
      return 'Tee desk - [E] arrivals, check-ins and walk-ins';
    },
    action: () => {
      if (!facilityInstalled(state, 'frontCounter') || !facilityInstalled(state, 'registerHardware')) {
        if (hooks.toast) hooks.toast(t('shop.installTheCounterAnd'), 'warn');
        return;
      }
      // The shared monitor owns selection and never mutates a reservation merely
      // because the player pressed E near the counter.
      if (register.enter() || register.isActive()) return;
      if (hooks.toast) hooks.toast(t('shop.theFrontDeskIs'), 'warn');
    },
  });

  // [R] is gone as a checkout verb — the change goes into a hand now, not into a
  // keypress. The API keeps the name so main.js does not have to care.
  const regConfirmChange = () => false;

  // The Pine Hills reception backdrop owns this wall now.  The legacy crest
  // was centred on COUNTER.x at the south wall and physically overlapped the
  // glazed main entrance after the desk rotated.
  const legacyEntranceCrestEnabled = false;
  if (legacyEntranceCrestEnabled) {

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
        emissive: 0xfff0d6, emissiveMap: logoTex, emissiveIntensity: 0.08,
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
    const wash = new THREE.SpotLight(0xffeed4, 3.5, 3.2, 0.8, 0.7, 1.6);
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
  const officeDeskFallbackRoot = new THREE.Group();
  officeDeskFallbackRoot.name = 'OfficeDeskFallbackRoot';
  interior.add(officeDeskFallbackRoot);
  const officeChairFallbackRoot = new THREE.Group();
  officeChairFallbackRoot.name = 'OfficeChairFallbackRoot';
  interior.add(officeChairFallbackRoot);
  const officeDeskCollider = colBoxAt(OFFICE.desk.x, OFFICE.desk.z, 1.1, 2.0);
  const officeChairCollider = colBoxAt(
    FRONT_DESK.staffChair.x,
    FRONT_DESK.staffChair.z,
    0.72,
    0.72,
  );
  let officeDeskColliderActive = false;
  let officeChairColliderActive = false;
  const setOfficeDeskColliderActive = (active) => {
    if (active && !officeDeskColliderActive) {
      addCol(officeDeskCollider);
      officeDeskColliderActive = true;
    } else if (!active && officeDeskColliderActive) {
      removeCol(officeDeskCollider);
      officeDeskColliderActive = false;
    }
  };
  const setOfficeChairColliderActive = (active) => {
    if (active && !officeChairColliderActive) {
      addCol(officeChairCollider);
      officeChairColliderActive = true;
    } else if (!active && officeChairColliderActive) {
      removeCol(officeChairCollider);
      officeChairColliderActive = false;
    }
  };
  {
    // The Sheet-04 executive desk (walnut top, two drawer pedestals, brass
    // pulls) replaces the plank desk. Its top is a real 0.75 desk height —
    // the laptop rig is self-relative, so the laptop simply sits lower.
    // Kit front (drawer faces) points +Z at ry 0; the desk faces the chair
    // to its west, so ry −π/2.
    const desk = new THREE.Group();
    desk.name = 'LegacyOfficeDesk';
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
    officeDeskFallbackRoot.add(desk);
    setOfficeDeskColliderActive(facilityInstalled(state, 'officeDesk'));
    merch.onReady(() => {
      const kitDesk = merch.instantiateKit && merch.instantiateKit('office_desk');
      if (!kitDesk) return;
      kitDesk.name = 'LegacyOfficeDeskAuthored';
      kitDesk.position.set(OFFICE.desk.x, 0, OFFICE.desk.z);
      kitDesk.rotation.y = -Math.PI / 2;
      officeDeskFallbackRoot.add(kitDesk);
      disposeClubhouseFallback(desk);
    });

    // Task chair — the Sheet-04 kit chair (five-star base, casters, black
    // leather) now backs up the shared reception seat. Asset 81 replaces it
    // in-place when the authored Sheet-09 GLB is ready.
    merch.onReady(() => {
      const kitChair = merch.instantiateKit && merch.instantiateKit('office_chair');
      const chair = kitChair || merch.instantiateRaw('office_chair');
      if (!chair) return;
      chair.position.set(FRONT_DESK.staffChair.x, 0, FRONT_DESK.staffChair.z);
      chair.rotation.y = FRONT_DESK.staffChair.ry;
      chair.name = 'LegacyOfficeChair';
      officeChairFallbackRoot.add(chair);
    });
    setOfficeChairColliderActive(facilityInstalled(state, 'officeChair'));

    // the Sheet-04 filing cabinet against the east wall, north of the desk —
    // LEDGERS / SUPPLIERS / STAFF / COURSE, which is the office's whole job
    merch.onReady(() => {
      const filing = merch.instantiateKit && merch.instantiateKit('filing_cabinet');
      if (!filing) return;
      filing.name = 'LegacyOfficeFilingCabinet';
      filing.position.set(9.88, 0, 2.75);
      filing.rotation.y = -Math.PI / 2;
      interior.add(filing);
    });
    addCol(colBoxAt(9.88, 2.75, 0.75, 0.6));

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
      const mapName = (state.clubName || 'THE CLUB').toUpperCase();
      let mapNameSize = 23;
      c2.font = `bold ${mapNameSize}px Georgia, serif`;
      while (c2.measureText(mapName).width > W - 190 && mapNameSize > 14) {
        mapNameSize--;
        c2.font = `bold ${mapNameSize}px Georgia, serif`;
      }
      c2.fillText(mapName, 20, TOP / 2 - 1);
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
      label: () => 'Course wall map - [E] step back to the overview camera',
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
    // The tee-sheet laptop shares the reception worktop. Its screen corners and
    // seated pose derive from this live matrix, so the UI cannot remain behind
    // on the retired office desk.
    laptop.position.set(FRONT_DESK.laptop.x, COUNTER_TOP + 0.003, FRONT_DESK.laptop.z);
    laptop.rotation.y = FRONT_DESK.laptop.ry;
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
      c2.fillText('GOLF SIMULATOR - press E to sign in', 256, 286);
      screenTex.needsUpdate = true;
    }
    // The front-desk machine must read as the management hub before the player
    // has used it once. A partly open, lit lock screen is visible from the
    // entrance; interaction still opens the lid fully and runs the boot flow.
    paintScreen('desk');
    office.paintScreen = paintScreen;
    office.screenMode = () => screenMode;

    // lid animation driven from the clubhouse update loop
    const LID_IDLE = LID_OPEN * 0.52;
    const lidState = { angle: LID_IDLE, target: LID_IDLE };
    lidHinge.rotation.x = LID_IDLE;
    led.material.emissiveIntensity = 0.75;
    office.updateLid = (dt) => {
      const diff = lidState.target - lidState.angle;
      if (Math.abs(diff) > 0.001) {
        lidState.angle += diff * Math.min(1, dt * 6.5);
        lidHinge.rotation.x = lidState.angle;
      }
      if (screenMode === 'boot') paintScreen(); // animate the progress bar
    };
    office.setLid = (open) => {
      lidState.target = open ? LID_OPEN : LID_IDLE;
      led.material.emissiveIntensity = open ? 1.4 : 0.75;
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

    const compWp = L2W(FRONT_DESK.laptop.x, FRONT_DESK.laptop.z);
    office.computerProp = addProp({
      x: compWp.x, z: compWp.z, r: 2.3,
      // G1: THE LAPTOP IS A WORK STATION, AND THE RULE ALREADY EXISTED.
      //
      // A station in reach outranks the equipped tool's prompt, so a mop in
      // hand does not have to be put down to use the counter. That was written
      // for the till and applied to the till and the reading desk — and the
      // laptop, which opens a full-screen station exactly like both of them, was
      // never tagged. So with a tool out the prompt read the mop, [E] did
      // nothing, and the player had to swap to empty hands to open their own
      // back office.
      station: true,
      label: () => facilityInstalled(state, 'laptop')
        ? 'Laptop - [E] open GOLF SIMULATOR'
        : null,
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

      // Measured before the greybox-walk item-9 correction: fracH 0.80 with a
      // +0.16h eye raise and a -0.10h aim drop produced a 78%-height panel taken
      // at a 24° downward dive from 0.48 yd — the screen filled the frame and the
      // lid's back-tilt keystoned the UI. The corrected seat sits ON the screen's
      // forward normal at the centre's own height, looks straight at the face,
      // and stands off far enough that the panel takes a comfortable share of the
      // frame with the deck and bezel as context.
      const dist = fitDistance({
        screenW: LAPTOP.screen.w, screenH: LAPTOP.screen.h, fovDeg, aspect, fracH: 0.62, fracW: 0.80,
      });
      const eye = centre.clone().addScaledVector(out, dist);
      const aim = centre.clone();

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

  let sheet07Production = null;
  function refreshCampaignVisualAvailability() {
    const deskReady = facilityInstalled(state, 'officeDesk');
    const chairReady = facilityInstalled(state, 'officeChair');
    officeDeskFallbackRoot.visible = deskReady;
    officeChairFallbackRoot.visible = chairReady;
    office.laptop.visible = facilityInstalled(state, 'laptop');
    setOfficeDeskColliderActive(deskReady);
    setOfficeChairColliderActive(chairReady);
    refreshCheckoutAvailability();
    // The current unified 61-100 runtime owns camera-distance visibility; older
    // Sheet 7 adapters exposed a campaign-specific refresh hook. Keep campaign
    // refresh compatible with both runtimes while Sheet07Production controls
    // the two facility-gated production meshes below.
    props61to100.refreshVisibility?.();
    if (sheet07Production) sheet07Production.refresh();
    // The signs are pushed from ONE place, every frame (see syncOpenClosedSigns
    // in update()); this only nudges it so a facility install repaints in the
    // same frame rather than the next one.
    syncOpenClosedSigns();
  }

  // Assets 61 and 66 already belong to the unified 61–100 runtime above.
  // Loading them again through the historical campaign adapter created two
  // counters and two office desks at diverging coordinates. Keep the public
  // Sheet07 facade for diagnostics/tests while sharing the one production root.
  sheet07Production = {
    ready: props61to100.ready.then(() => ({
      loaded: [61, 66].filter((number) => !!props61to100.getRoot(number)).length,
      failed: [61, 66].filter((number) => !props61to100.getRoot(number)).length,
    })),
    refresh() {},
    getRoot: (number) => props61to100.getRoot(number),
    diagnostics: () => {
      const assetNumbers = [61, 66].filter((number) => !!props61to100.getRoot(number));
      return {
        expected: 2,
        loaded: assetNumbers.length,
        failed: 2 - assetNumbers.length,
        failures: [],
        assetNumbers,
        sharedRuntime: true,
      };
    },
  };
  refreshCampaignVisualAvailability();

  // buildCampaignWorld registers [E] facility-install, repair-site and
  // clubhouse-opening props (not just meshes — the interior whitelist alone
  // cannot gate them) at clubhouse coordinates. In the shed they are pure
  // noise, so the whole campaign interaction layer is skipped and replaced with
  // a stub exposing only the refresh/diagnostics surface makeClubhouse reads.
  const campaignWorld = shedPresentation ? {
    refresh() {},
    diagnostics: () => ({ facilitiesVisible: [], repairsVisible: [] }),
    openingProp: null,
    root: null,
  } : buildCampaignWorld(B, {
    refreshWorld(kind) {
      refreshCampaignVisualAvailability();
      if (kind === 'repair') rebuildReno();
      if (kind === 'facility') rebuildLayout();
      refreshCondition();
    },
  });

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

    // Original, text-free Pine Hills course art remains mounted on the existing
    // furnished-lounge photo prop; only its source texture is replaced.
    const photoTex = new THREE.TextureLoader().load(
      'public/assets/textures/clubhouse/pine-hills-course-photo-v1.png',
      undefined,
      undefined,
      () => {},
    );
    photoTex.colorSpace = THREE.SRGBColorSpace;
    photoTex.anisotropy = 4;
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 0.78), new THREE.MeshStandardMaterial({ map: photoTex, roughness: 0.85 }));
    photo.name = 'PineHillsOriginalCoursePhoto';
    photo.position.set(LOUNGE.photo.x, 1.95, -INTERIOR.d / 2 + 0.05);
    interior.add(photo);
    const photoFrame = new THREE.Mesh(new THREE.PlaneGeometry(1.30, 0.92), new THREE.MeshStandardMaterial({ color: 0x3d3122, roughness: 0.8 }));
    photoFrame.name = 'PineHillsOriginalCoursePhotoFrame';
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
      label: () => 'Old clutter - [E] haul it out',
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
        presentRestorationFeedback(res.restoration);
        if (hooks.sfx) hooks.sfx('thunk');
        if (hooks.toast) hooks.toast(t('shop.hauledAPileOf'));
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
      const colliderWidth = Math.abs(cos) * w + Math.abs(sin) * d;
      const colliderDepth = Math.abs(sin) * w + Math.abs(cos) * d;
      return colBoxAt(bx, bz, colliderWidth, colliderDepth);
    };
    return { group: g, colliders: [worldBox(0, 0, 2.2, 0.95), worldBox(0, 1.05, 1.15, 0.6)] };
  }

  const DECOR_BUILDERS = {
    rug1: makeRugMesh, plant1: makePlantMesh, poster1: makePosterMesh,
    board1: makeBoardMesh, light1: makePendantMesh, lounge1: makeLoungeMesh,
  };

  for (const sku of SHOP_CATALOG) {
    if (!sku.modelPath || !sku.placeableProfile) continue;
    DECOR_BUILDERS[sku.id] = (spot, ghost, visualOptions = {}) => {
      const group = buildPropertyFurnitureVisual(sku, {
        ghostMaterial: ghost ? ghostMat : null,
        ...visualOptions,
      });
      const profile = sku.placeableProfile;
      const cosine = Math.abs(Math.cos(spot.ry || 0));
      const sine = Math.abs(Math.sin(spot.ry || 0));
      const width = cosine * profile.width + sine * profile.depth;
      const depth = sine * profile.width + cosine * profile.depth;
      return {
        group,
        colliders: !ghost && profile.blocksMovement
          ? [colBoxAt(spot.x, spot.z, width, depth)]
          : [],
      };
    };
  }

  function createPlaceablePreview(skuId) {
    const build = DECOR_BUILDERS[skuId];
    if (!build) return null;
    return build({ x: 0, z: 0, ry: 0 }, true).group;
  }

  function ghostify(g) {
    const materials = new Set();
    const textures = new Set();
    g.traverse((o) => {
      if (o.isMesh) {
        for (const material of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!material || material === ghostMat) continue;
          materials.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
        o.material = ghostMat;
        o.castShadow = false;
      }
      if (o.isPointLight) o.intensity = 0;
    });
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    return g;
  }

  function disposeDecorRenderable(root) {
    root.userData.disposed = true;
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    root.traverse((object) => {
      if (object.geometry
          && !object.geometry.userData?.golfFlipperSharedPropertyFurnitureResource) {
        geometries.add(object.geometry);
      }
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material || material === ghostMat) continue;
        if (material.userData?.golfFlipperSharedPropertyFurnitureResource) continue;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture
              && !value.userData?.golfFlipperSharedPropertyFurnitureResource) textures.add(value);
        }
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
  }

  function buildDecorPose(skuId, pose, options = {}) {
    const { ghost = false, spotIdx = null, placementId = null } = options;
    const sku = SHOP_CATALOG.find((sk) => sk.id === skuId);
    const placement = placementId
      ? placedPropertyItems(state).find((candidate) => candidate.id === placementId)
      : null;
    const built = DECOR_BUILDERS[skuId](pose, ghost, {
      componentStates: placement?.componentStates || {},
      lightState: placement?.lightState || null,
      circuitPowered: () => ceilingCircuitPoweredSim(state),
      onComponentStateChange: ({ name, open, type }) => {
        if (placementId) setPlacementComponentState(state, placementId, name, open);
        if (hooks.sfx) hooks.sfx(open ? 'drawerOpen' : 'drawerClose');
        if (hooks.toast) {
          const noun = type === 'drawer' ? 'drawer' : 'cabinet door';
          hooks.toast(`${sku.name} ${noun} ${open ? 'opened' : 'closed'}.`);
        }
      },
      onLightPowerChange: (isOn) => {
        if (placementId) setPlacementLightPower(state, placementId, isOn);
        if (hooks.sfx) hooks.sfx('lightSwitch');
        if (hooks.toast) {
          const powered = ceilingCircuitPoweredSim(state);
          hooks.toast(powered || !isOn
            ? `${sku.name} switched ${isOn ? 'on' : 'off'}.`
            : `${sku.name} is switched on, but the clubhouse ceiling circuit has no power.`,
          powered || !isOn ? undefined : 'warn');
        }
      },
      onSpotlightAimChange: ({ headIndex, yaw, tilt, presetLabel }) => {
        if (placementId) setPlacementSpotlightAim(state, placementId, headIndex, yaw, tilt);
        if (hooks.sfx) hooks.sfx('fixtureAdjust');
        if (hooks.toast) hooks.toast(t('shop.spotlightAimed', { name: sku.name, head: headIndex + 1, preset: presetLabel }));
      },
    });
    built.group.position.set(pose.x, 0, pose.z);
    built.group.rotation.y = pose.ry;
    if (ghost) ghostify(built.group);
    built.group.userData.playerPlacedFurniture = !ghost;
    interior.add(built.group);
    if (!ghost && popNextDecor && popNextDecor.skuId === skuId
        && (popNextDecor.placementId === placementId || popNextDecor.spot === spotIdx)) {
      popNextDecor = null;
      tweenScale(built.group, 0.55, 1, 0.28);
    }
    const entry = {
      group: built.group,
      colliders: ghost ? [] : built.colliders,
      prop: null,
      props: [],
      propActive: false,
      collidersActive: !ghost,
      dynamicColliderUpdates: [],
      placementId,
      skuId,
      spotIdx,
    };
    for (const c of entry.colliders) {
      c.playerPlacedFurniture = true;
      addCol(c);
    }
    const wp = L2W(pose.x, pose.z);
    if (!ghost) {
      entry.prop = addProp({
        x: wp.x, z: wp.z, r: 1.9,
        label: () => `${sku.name} - [E] pack it back up`,
        action: () => {
          const removed = placementId
            ? removeDecorPlacement(state, placementId)
            : removeDecor(state, skuId, spotIdx);
          if (!removed.ok) {
            if (hooks.toast) hooks.toast(removed.reason || 'That furniture cannot be packed yet.', 'warn');
            return;
          }
          rebuildDecor();
          refreshCondition();
          if (hooks.sfx) hooks.sfx('thunk');
          if (hooks.toast) hooks.toast(`${sku.name} packed up - it's back in the backroom.`);
        },
      });
      entry.prop.playerPlacedFurniture = true;
      entry.props.push(entry.prop);
      entry.propActive = true;

      // The authored GLB arrives asynchronously.  Once it is attached, move
      // the packing prompt to the rear service anchor and register each handle
      // as a true 3D focus target.  `aimY`/focusPoint lets vertically stacked
      // drawers remain individually selectable with the first-person camera.
      void built.group.userData.ready?.then(() => {
        if (built.group.userData.disposed || !decorObjs.includes(entry)) return;
        const modelRoot = built.group.userData.modelRoot;
        const packAnchor = modelRoot?.getObjectByName('PACK_ANCHOR');
        if (packAnchor) {
          const packPoint = new THREE.Vector3();
          const updatePackPoint = () => packAnchor.getWorldPosition(packPoint);
          const point = updatePackPoint();
          entry.prop.x = point.x;
          entry.prop.z = point.z;
          entry.prop.aimY = point.y;
          entry.prop.focusPoint = updatePackPoint;
        } else if (sku.furnitureCategory === 'ceiling-lights' && modelRoot) {
          // The switch lives near the fixture centre. Keep packing available at
          // a separate service-edge target so looking at the lamp selects power.
          const packPoint = new THREE.Vector3();
          const localPackPoint = new THREE.Vector3(
            Math.max(0.14, Number(sku.dimensionsM?.[0]) * 0.58),
            -Math.min(0.42, Math.max(0.08, Number(sku.dimensionsM?.[1]) * 0.28)),
            0,
          );
          const updatePackPoint = () => modelRoot.localToWorld(packPoint.copy(localPackPoint));
          const point = updatePackPoint();
          entry.prop.x = point.x;
          entry.prop.z = point.z;
          entry.prop.aimY = point.y;
          entry.prop.focusPoint = updatePackPoint;
          entry.prop.focusBias = 0.08;
        }
        for (const component of built.group.userData.interactiveComponents || []) {
          const point = new THREE.Vector3();
          const focusPoint = () => component.interactionNode.getWorldPosition(point);
          const initial = focusPoint();
          const componentNoun = component.type === 'drawer'
            ? `${component.label} drawer`
            : `${component.label} cabinet door`;
          const prop = {
            x: initial.x,
            z: initial.z,
            r: 1.65,
            aimY: initial.y,
            focusPoint,
            // Drawer and door handles sit close to the desk body and can share
            // the crosshair with nearby fixtures.  Give the authored 3D handle
            // a modest priority once the player is already inside its reach.
            focusBias: 0.34,
            label: () => `${sku.name} ${componentNoun.toLowerCase()} - [E] ${component.isOpen() ? 'close' : 'open'}`,
            action: () => component.toggle(),
          };
          prop.playerPlacedFurniture = true;
          prop.furnitureComponent = component.name;
          entry.props.push(prop);
          if (entry.propActive) addProp(prop);
        }
        const lightController = built.group.userData.ceilingLightController;
        if (lightController) {
          const powerPoint = new THREE.Vector3();
          const powerFocusPoint = () => lightController.controlNode.getWorldPosition(powerPoint);
          const initialPowerPoint = powerFocusPoint();
          const powerProp = {
            x: initialPowerPoint.x,
            z: initialPowerPoint.z,
            r: 1.9,
            aimY: initialPowerPoint.y,
            focusPoint: powerFocusPoint,
            focusBias: 0.72,
            label: () => {
              const circuit = lightController.isCircuitPowered();
              const verb = lightController.isOn() ? 'switch off' : 'switch on';
              return circuit
                ? `${sku.name} - [E] ${verb}`
                : `${sku.name} - ceiling circuit has no power · [E] ${verb}`;
            },
            action: () => lightController.toggle(),
          };
          powerProp.playerPlacedFurniture = true;
          powerProp.lightControl = 'power';
          entry.props.push(powerProp);
          if (entry.propActive) addProp(powerProp);

          for (const head of lightController.headControllers) {
            if (!head.interactionNode) continue;
            const point = new THREE.Vector3();
            const focusPoint = () => head.interactionNode.getWorldPosition(point);
            const initial = focusPoint();
            const prop = {
              x: initial.x,
              z: initial.z,
              r: 1.75,
              aimY: initial.y,
              focusPoint,
              focusBias: 0.86,
              label: () => `${sku.name} spotlight ${head.index + 1} - [E] change aim (${head.presetLabel})`,
              action: () => head.cycle(),
            };
            prop.playerPlacedFurniture = true;
            prop.lightControl = `spotlight-${head.index + 1}`;
            entry.props.push(prop);
            if (entry.propActive) addProp(prop);
          }
        }

        if (placementId && sku.furnitureCategory === 'freestanding-shelving') {
          const interactionNode = built.group.userData.functionalNodes?.interactionPoint || modelRoot;
          if (interactionNode) {
            const point = new THREE.Vector3();
            const focusPoint = () => interactionNode.getWorldPosition(point);
            const initial = focusPoint();
            const stockProp = {
              x: initial.x,
              z: initial.z,
              r: 2.1,
              aimY: initial.y,
              focusPoint,
              focusBias: 0.24,
              label: () => {
                const held = carriedGoods(state);
                const summary = retailShelfPlacementSummary(state, placementId);
                if (held) {
                  const product = SHOP_CATALOG.find((candidate) => candidate.id === held.skuId);
                  return `${sku.name} - [E] stock ${product?.name || 'carried product'} (${summary?.units || 0}/${summary?.capacity || 0})`;
                }
                return summary?.units
                  ? `${sku.name} - [E] take a product (${summary.units}/${summary.capacity})`
                  : `${sku.name} - empty · carry retail goods here to stock it`;
              },
              action: () => {
                const wasCarrying = !!carriedGoods(state);
                const result = wasCarrying
                  ? stockRetailShelf(state, placementId, 1)
                  : takeFromRetailShelf(state, placementId, 1);
                if (!result.ok) {
                  if (hooks.toast) hooks.toast(result.reason || 'Could not change this shelf stock.', 'warn');
                  return;
                }
                rebuildStock();
                rebuildBoxes();
                if (hooks.sfx) hooks.sfx('thunk');
                if (hooks.toast) {
                  const product = SHOP_CATALOG.find((candidate) => candidate.id === result.skuId);
                  hooks.toast(wasCarrying
                    ? `${product?.name || 'Product'} stocked on ${sku.name}.`
                    : `${product?.name || 'Product'} taken from ${sku.name}.`);
                }
              },
            };
            stockProp.playerPlacedFurniture = true;
            stockProp.retailShelfStock = placementId;
            entry.props.push(stockProp);
            if (entry.propActive) addProp(stockProp);
          }

          for (const storageName of built.group.userData.functionalNodes?.storageNodes || []) {
            const storageNode = built.group.userData.functionalNodes?.byName?.[storageName];
            if (!storageNode) continue;
            const match = /^STORAGE_ZONE_Bay(\d{2})_Level(\d{2})$/.exec(storageNode.name || '');
            if (!match) continue;
            const bay = Number(match[1]);
            const level = Number(match[2]);
            const bayDoors = (built.group.userData.interactiveComponents || []).filter((component) => (
              component.type === 'cabinet-door'
                && component.name.startsWith(`CabinetDoor_Bay${match[1]}_`)
            ));
            const cabinetOpen = () => bayDoors.some((component) => component.isOpen());
            const point = new THREE.Vector3();
            const focusPoint = () => storageNode.getWorldPosition(point);
            const initial = focusPoint();
            const storageProp = {
              x: initial.x,
              z: initial.z,
              r: 1.55,
              aimY: initial.y,
              focusPoint,
              // Closed door handles retain priority. Once a leaf is open and
              // the player looks into the bay, the authored storage socket is
              // the closest focus target.
              focusBias: 0.12,
              label: () => {
                const summary = retailShelfStorageSummary(state, placementId);
                const held = carriedGoods(state);
                if (!cabinetOpen()) return `${sku.name} bay ${bay} cabinet - open a door to use storage`;
                if (held) {
                  const product = SHOP_CATALOG.find((candidate) => candidate.id === held.skuId);
                  return `${sku.name} cabinet - [E] store ${product?.name || 'carried product'} (${summary?.units || 0}/${summary?.capacity || 0})`;
                }
                return summary?.units
                  ? `${sku.name} cabinet - [E] take stored product (${summary.units}/${summary.capacity})`
                  : `${sku.name} cabinet - empty`;
              },
              action: () => {
                if (!cabinetOpen()) {
                  if (hooks.toast) hooks.toast(t('shop.openBayDoorFirst', { bay }), 'warn');
                  return;
                }
                const wasCarrying = !!carriedGoods(state);
                const result = wasCarrying
                  ? storeRetailShelfCabinet(state, placementId, storageNode.name, 1)
                  : takeFromRetailShelfCabinet(state, placementId, storageNode.name, 1);
                if (!result.ok) {
                  if (hooks.toast) hooks.toast(result.reason || 'Could not change this cabinet storage.', 'warn');
                  return;
                }
                rebuildStock();
                rebuildBoxes();
                if (hooks.sfx) hooks.sfx('thunk');
                if (hooks.toast) {
                  const product = SHOP_CATALOG.find((candidate) => candidate.id === result.skuId);
                  hooks.toast(wasCarrying
                    ? `${product?.name || 'Product'} stored in ${sku.name}, bay ${bay}, level ${level}.`
                    : `${product?.name || 'Product'} taken from ${sku.name}, bay ${bay}, level ${level}.`);
                }
              },
            };
            storageProp.playerPlacedFurniture = true;
            storageProp.retailShelfStorage = placementId;
            storageProp.storageZone = storageNode.name;
            entry.props.push(storageProp);
            if (entry.propActive) addProp(storageProp);
          }

          // The building collision system is 2D, so project each independently
          // animated door's live world bounds into a mutable AABB. The collider
          // follows the hinge instead of remaining across an opened doorway.
          for (const component of built.group.userData.interactiveComponents || []) {
            if (component.type !== 'cabinet-door') continue;
            const collider = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, playerPlacedFurniture: true };
            const bounds = new THREE.Box3();
            const updateCollider = () => {
              component.node.updateWorldMatrix(true, true);
              bounds.setFromObject(component.node);
              collider.minX = bounds.min.x;
              collider.maxX = bounds.max.x;
              collider.minZ = bounds.min.z;
              collider.maxZ = bounds.max.z;
            };
            updateCollider();
            entry.colliders.push(collider);
            entry.dynamicColliderUpdates.push(updateCollider);
            if (entry.collidersActive) addCol(collider);
          }
          rebuildStock();
        }
      });
    } else {
      entry.prop = addProp({
        x: wp.x, z: wp.z, r: 1.9,
        label: () => `Place the ${sku.name.toLowerCase()} here - [E]`,
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
          if (hooks.toast) hooks.toast(t('shop.placedComingTogether', { name: sku.name }));
        },
      });
      entry.props.push(entry.prop);
      entry.propActive = true;
    }
    decorObjs.push(entry);
    return entry;
  }

  function buildDecorAt(skuId, spotIdx, ghost) {
    return buildDecorPose(skuId, DECOR_SPOTS[skuId][spotIdx], { ghost, spotIdx });
  }

  function setDecorPlacementVisible(placementId, visible) {
    const entry = decorObjs.find((decor) => decor.placementId === placementId);
    if (!entry || entry.group.visible === visible) return false;
    entry.group.visible = visible;
    if (visible) {
      if (!entry.collidersActive) {
        for (const collider of entry.colliders) addCol(collider);
        entry.collidersActive = true;
      }
      if (entry.props.length && !entry.propActive) {
        for (const prop of entry.props) addProp(prop);
        entry.propActive = true;
      }
    } else {
      if (entry.collidersActive) {
        for (const collider of entry.colliders) removeCol(collider);
        entry.collidersActive = false;
      }
      if (entry.props.length && entry.propActive) {
        for (const prop of entry.props) removeProp(prop);
        entry.propActive = false;
      }
    }
    return true;
  }

  function rebuildDecor() {
    for (const d of decorObjs) {
      interior.remove(d.group);
      if (d.collidersActive) for (const c of d.colliders) removeCol(c);
      if (d.propActive) for (const prop of d.props) removeProp(prop);
      disposeDecorRenderable(d.group);
    }
    decorObjs.length = 0;
    const reno = state && state.shop && state.shop.reno;
    if (!reno) return;
    const placements = new Map(placedPropertyItems(state).map((entry) => [entry.id, entry]));
    for (const d of reno.decor) {
      const placement = placements.get(d.placementId);
      if (placement && DECOR_BUILDERS[d.skuId]) {
        buildDecorPose(d.skuId, placement.pose, { placementId: placement.id, spotIdx: d.spot });
      } else if (DECOR_BUILDERS[d.skuId] && DECOR_SPOTS[d.skuId]?.[d.spot]) {
        buildDecorAt(d.skuId, d.spot, false);
      }
    }
    for (const skuId of Object.keys(DECOR_BUILDERS)) {
      const inv = state.shop.inventory[skuId];
      if (!inv || inv.back <= 0) continue;
      const spots = DECOR_SPOTS[skuId];
      if (!spots) continue;
      spots.forEach((spot, idx) => {
        if (!reno.decor.some((d) => d.skuId === skuId && d.spot === idx)) buildDecorAt(skuId, idx, true);
      });
    }
  }

  let decorSig = '';
  function decorSignature() {
    if (!state || !state.shop) return '';
    const placementById = new Map(placedPropertyItems(state).map((entry) => [entry.id, entry]));
    let sig = (state.shop.reno?.decor || []).map((entry) => {
      const pose = placementById.get(entry.placementId)?.pose;
      return pose
        ? `${entry.placementId}:${pose.x}:${pose.z}:${pose.ry}:${pose.surfaceId}`
        : `${entry.skuId}:${entry.spot}`;
    }).join('|');
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
    // Debris can change as part of a loaded renovation snapshot or a deterministic QA fixture.
    // Keep its instanced presentation in lockstep with that state whenever the renovation layer
    // is rebuilt; cleaning interactions already call the same refresh directly.
    refreshDebrisVisual();
    refreshCondition();
    void sheet06Production.applyState(state);
    void architecturalDoorInstallation.syncServiceDoors();
  }

  // --- live stock silhouettes -------------------------------------------------------------
  const stockGroup = new THREE.Group();
  stockGroup.name = 'shop-stock';
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
  let pinePackageAtlasImage = null;
  let pinePackageAtlasLoading = false;
  const pendingPinePackagePainters = new Set();

  function ensurePinePackageAtlas() {
    if (pinePackageAtlasImage || pinePackageAtlasLoading) return;
    pinePackageAtlasLoading = true;
    new THREE.TextureLoader().load(
      'public/assets/textures/shop/pine-hills-package-background-atlas-v1.png',
      (source) => {
        pinePackageAtlasImage = source.image;
        for (const paint of pendingPinePackagePainters) paint();
        pendingPinePackagePainters.clear();
        source.dispose();
      },
      undefined,
      () => {
        pinePackageAtlasLoading = false;
        pendingPinePackagePainters.clear();
      },
    );
  }

  function pinePackageLabelTexture(sku, quadrant, {
    width = 512,
    height = 640,
    descriptor = 'PRO SHOP',
  } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const clubName = String(state?.clubName || 'Pine Hills Municipal Golf').trim().toUpperCase();
    const productName = String(sku?.name || sku?.id || 'Clubhouse goods').trim().toUpperCase();
    const words = productName.split(/\s+/).filter(Boolean);
    const split = words.length > 2 ? Math.ceil(words.length / 2) : words.length;
    const nameLines = words.length > 2
      ? [words.slice(0, split).join(' '), words.slice(split).join(' ')]
      : [productName];
    const setFittedFont = (value, maxWidth, startSize, minimumSize, weight = 800) => {
      let size = startSize;
      do {
        context.font = `${weight} ${Math.round(size)}px system-ui, sans-serif`;
        if (context.measureText(value).width <= maxWidth || size <= minimumSize) break;
        size -= 2;
      } while (size > minimumSize);
    };
    const paint = () => {
      context.clearRect(0, 0, width, height);
      context.fillStyle = quadrant % 2 ? '#a8b59a' : '#204936';
      context.fillRect(0, 0, width, height);
      if (pinePackageAtlasImage) {
        const image = pinePackageAtlasImage;
        const cellX = quadrant % 2;
        const cellY = Math.floor(quadrant / 2);
        const sourceX = image.width * (cellX * 0.5 + 0.025);
        const sourceY = image.height * (cellY * 0.5 + 0.025);
        const sourceW = image.width * 0.45;
        const sourceH = image.height * 0.45;
        context.drawImage(image, sourceX, sourceY, sourceW, sourceH, 0, 0, width, height);
      }
      const bandTop = height * 0.46;
      context.fillStyle = 'rgba(22, 55, 40, 0.91)';
      context.fillRect(width * 0.06, bandTop, width * 0.88, height * 0.46);
      context.strokeStyle = '#d0b36d';
      context.lineWidth = Math.max(4, width * 0.012);
      context.strokeRect(width * 0.075, bandTop + height * 0.018, width * 0.85, height * 0.424);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = '#d9bd76';
      setFittedFont(clubName, width * 0.74, height * 0.055, height * 0.032, 750);
      context.fillText(clubName, width / 2, height * 0.55);
      context.fillStyle = '#fff4de';
      nameLines.forEach((line, index) => {
        setFittedFont(line, width * 0.72, height * 0.094, height * 0.055);
        context.fillText(line, width / 2, height * (nameLines.length === 1 ? 0.69 : 0.65 + index * 0.10));
      });
      context.fillStyle = '#d7cab0';
      context.font = `700 ${Math.round(height * 0.042)}px system-ui, sans-serif`;
      context.fillText(descriptor, width / 2, height * 0.84);
    };
    paint();
    if (!pinePackageAtlasImage) pendingPinePackagePainters.add(paint);
    ensurePinePackageAtlas();
    const texture = new THREE.CanvasTexture(canvas);
    texture.name = `PineHillsPackageLabel_${sku?.id || 'unknown'}`;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const repaint = paint;
    pendingPinePackagePainters.delete(paint);
    if (!pinePackageAtlasImage) pendingPinePackagePainters.add(() => {
      repaint();
      texture.needsUpdate = true;
    });
    return texture;
  }

  function ballLabelMat(sku) {
    if (!labelCache.has(sku.id)) {
      const tex = pinePackageLabelTexture(sku, 0, {
        width: 640,
        height: 448,
        descriptor: `${sku.tier || 1} DOZEN`,
      });
      labelCache.set(sku.id, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    }
    return labelCache.get(sku.id);
  }
  function cartonLabelMat(sku, brand) {
    const key = 'carton:' + sku.id;
    if (!labelCache.has(key)) {
      const tex = pinePackageLabelTexture(sku, 1, {
        width: 640,
        height: 448,
        descriptor: brand || 'GOLF ACCESSORIES',
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
  const UNIT_LABEL_GEO = new THREE.PlaneGeometry(1, 1);
  BALL_BOX_GEO.userData.sharedGeometry = true;
  CARTON_GEO.userData.sharedGeometry = true;
  UNIT_LABEL_GEO.userData.sharedGeometry = true;
  const STOCK_PREVIEW_MAT = new THREE.MeshBasicMaterial({
    color: 0xd0ad4f, transparent: true, opacity: 0.58, wireframe: true, depthWrite: false,
  });
  const POLO_TINTS = {
    polo1: 0x4e7a52, polo2: 0x5b7f9e, jacket2: 0x33455e,
    pants2: 0x7d7667, shorts1: 0xb8a785,
  };
  const BAG_TINTS = [0x53688c, 0x4e8059, 0xb9b3a6, 0x9a7a56];
  const SHOE_DISPLAY_TINTS = [0xf0ead8, 0x78957e, 0x53688c, 0xd8d1bf, 0x315c43, 0xb8aa91];
  const CARTON_BRAND = { tees1: 'CADDIE CLUB', marker1: 'CADDIE CLUB' };
  const skuMats = new Map();
  const ballBoxMats = new Map();
  const snackLabelMats = new Map();
  const drinkMats = new Map();
  const reserveLabelGeo = new THREE.PlaneGeometry(0.48, 0.11);
  const reserveLabelCache = new Map();
  let reserveLabelGeneration = 0;

  function reserveLabelMat(sku, quantity) {
    const key = `${sku.id}:${quantity}`;
    const cached = reserveLabelCache.get(key);
    if (cached) {
      cached.used = reserveLabelGeneration;
      return cached.material;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 384; canvas.height = 96;
    const c = canvas.getContext('2d');
    c.fillStyle = '#efe9d9'; c.fillRect(0, 0, canvas.width, canvas.height);
    c.strokeStyle = '#b99751'; c.lineWidth = 5; c.strokeRect(3, 3, 378, 90);
    c.fillStyle = '#1f4a26'; c.font = 'bold 25px Georgia';
    c.fillText(sku.name.slice(0, 21), 12, 37);
    c.fillStyle = '#292b27'; c.font = 'bold 30px Georgia';
    c.fillText(`RESERVE ×${quantity}`, 12, 75);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.84 });
    reserveLabelCache.set(key, { material, used: reserveLabelGeneration });
    return material;
  }

  function pruneReserveLabels() {
    for (const [key, entry] of reserveLabelCache) {
      if (entry.used === reserveLabelGeneration) continue;
      if (entry.material.map) entry.material.map.dispose();
      entry.material.dispose();
      reserveLabelCache.delete(key);
    }
  }

  function skuMat(sku) {
    if (!skuMats.has(sku.id)) {
      const color = new THREE.Color(CAT_COLORS[sku.cat] || 0x999999);
      color.offsetHSL(0, 0, (sku.tier - 2) * 0.09);
      skuMats.set(sku.id, new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    }
    return skuMats.get(sku.id);
  }

  // Generated art supplies only the text-free package background; exact product
  // and saved-club names remain deterministic canvas text.
  function snackLabelMat(sku) {
    if (!snackLabelMats.has(sku.id)) {
      const tex = pinePackageLabelTexture(sku, 3, { descriptor: 'CLUBHOUSE SNACKS' });
      snackLabelMats.set(sku.id, new THREE.MeshStandardMaterial({
        map: tex, color: 0xffffff, roughness: 0.82, metalness: 0,
      }));
    }
    return snackLabelMats.get(sku.id);
  }

  function waterLabelMat(sku) {
    const key = `water-label:${sku.id}`;
    if (!snackLabelMats.has(key)) {
      const tex = pinePackageLabelTexture(sku, 2, { descriptor: 'FAIRWAY SPRING' });
      snackLabelMats.set(key, new THREE.MeshStandardMaterial({
        map: tex, color: 0xffffff, roughness: 0.76, metalness: 0,
      }));
    }
    return snackLabelMats.get(key);
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
    return skuMat(sku);
  }

  function frontLabel(material, w, h, z) {
    const label = new THREE.Mesh(UNIT_LABEL_GEO, material);
    label.scale.set(w, h, 1);
    label.position.z = z;
    return label;
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

  function drinkMat(sku) {
    if (!drinkMats.has(sku.id)) {
      const colors = { water1: 0xb9d8d4, sportdrink2: 0x6f9367, soda1: 0x51332c };
      drinkMats.set(sku.id, new THREE.MeshStandardMaterial({
        color: colors[sku.id] || 0x809b78, roughness: 0.58,
      }));
    }
    return drinkMats.get(sku.id);
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

    if (id.startsWith('glove')) {
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
      const display = new THREE.Group();
      display.position.set(s.x, s.y, s.z);
      display.rotation.y = s.ry || 0;
      display.add(product);
      const label = frontLabel(
        id === 'water1' ? waterLabelMat(sku) : snackLabelMat(sku),
        id === 'water1' ? 0.052 : 0.132,
        id === 'water1' ? 0.074 : 0.132,
        id === 'water1' ? 0.035 : 0.037,
      );
      label.position.y = id === 'water1' ? 0.112 : 0.105;
      display.add(label);
      return display;
    }

    if (sku.form === 'drink' || sku.form === 'bottle' || sku.form === 'can') {
      const g = new THREE.Group();
      const can = sku.form === 'can';
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(can ? 0.040 : 0.044, can ? 0.040 : 0.036, can ? 0.14 : 0.19, 10),
        drinkMat(sku),
      );
      body.position.set(s.x, s.y + (can ? 0.07 : 0.095), s.z);
      body.castShadow = true;
      g.add(body);
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(can ? 0.041 : 0.045, can ? 0.041 : 0.041, can ? 0.055 : 0.065, 10),
        mats.trimPaint,
      );
      band.position.set(s.x, s.y + (can ? 0.075 : 0.095), s.z);
      g.add(band);
      if (!can) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.020, 0.025, 8), mats.brass);
        cap.position.set(s.x, s.y + 0.202, s.z);
        g.add(cap);
      }
      return g;
    }

    if (sku.form === 'snack' || sku.form === 'bar') {
      const g = new THREE.Group();
      const isBar = sku.form === 'bar';
      const w = isBar ? 0.18 : 0.17;
      const h = isBar ? 0.14 : 0.22;
      const bodyMat = skuMat(sku);
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, 0.055),
        bodyMat,
      );
      body.position.set(s.x, s.y + h / 2, s.z);
      body.rotation.z = (i % 2) * 0.035 - 0.0175;
      body.castShadow = true;
      const label = frontLabel(snackLabelMat(sku), w * 0.86, h * 0.82, 0.0285);
      label.position.x = s.x;
      label.position.y = body.position.y;
      label.position.z = s.z + 0.0285;
      label.rotation.z = body.rotation.z;
      g.add(body, label);
      const seal = new THREE.Mesh(new THREE.BoxGeometry(w * 0.88, 0.012, 0.061), mats.brass);
      seal.position.set(s.x, s.y + h - 0.008, s.z);
      seal.rotation.z = body.rotation.z;
      g.add(seal);
      return g;
    }

    if (sku.form === 'scorecard') {
      const card = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.008, 0.11), cartonMat(sku));
      card.position.set(s.x, s.y, s.z);
      card.rotation.y = s.ry || 0;
      return card;
    }

    if (sku.form === 'eyewear') {
      const g = new THREE.Group();
      for (const dx of [-0.045, 0.045]) {
        const lens = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.007, 6, 12), mats.merchDark);
        lens.position.set(s.x + dx, s.y, s.z);
        g.add(lens);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.009, 0.009), mats.brass);
      bridge.position.set(s.x, s.y, s.z);
      g.add(bridge);
      return g;
    }

    if (sku.form === 'carded') {
      const g = new THREE.Group();
      const card = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.018), cartonMat(sku));
      card.position.set(s.x, s.y, s.z);
      const brand = CARTON_BRAND[sku.id];
      if (brand) {
        const label = frontLabel(cartonLabelMat(sku, brand), 0.116, 0.08, s.z + 0.010);
        label.position.x = s.x;
        label.position.y = s.y;
        g.add(label);
      }
      const tool = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.07, 3, 6), mats.brass);
      tool.position.set(s.x, s.y - 0.01, s.z + 0.018);
      tool.rotation.z = 0.35;
      g.add(card, tool);
      return g;
    }

    // cartoned smalls: cream cartons with a branded band, neatly fronted
    const item = new THREE.Mesh(CARTON_GEO, cartonMat(sku));
    item.position.set(s.x, s.y, s.z);
    item.castShadow = true;
    const brand = CARTON_BRAND[sku.id];
    if (!brand) return item;
    const g = new THREE.Group();
    const label = frontLabel(cartonLabelMat(sku, brand), 0.10, 0.07, s.z + 0.056);
    label.position.x = s.x;
    label.position.y = s.y;
    g.add(item, label);
    return g;
  }

  function makePresentedStockItem(sku, slot, index) {
    const item = makeStockItem(sku, slot, index);
    const tip = slot?.starterPresentation?.tip;
    if (!item || !tip) return item;

    // makeStockItem uses fixture-local authored coordinates. Rebase the real
    // inventory unit around its own socket before adding the small presentation
    // rotation; this tips that package without shifting it to another slot or
    // introducing a renderer-only duplicate.
    const pivot = new THREE.Group();
    pivot.name = `StarterTippedPackage_${sku.id}_${slot.starterPresentation.slotIndex}`;
    pivot.position.set(slot.x, slot.y, slot.z);
    item.position.sub(pivot.position);
    pivot.rotation.set(tip.x || 0, tip.y || 0, tip.z || 0);
    pivot.userData.starterTippedPackage = {
      skuId: sku.id,
      slotIndex: slot.starterPresentation.slotIndex,
    };
    pivot.add(item);
    return pivot;
  }

  function releaseVisual(root) {
    if (!root) return;
    root.traverse((object) => {
      if (object.isMesh && object.geometry && !object.geometry.userData.sharedGeometry) object.geometry.dispose();
      if (!object.userData.disposeMaterial) return;
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material) continue;
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          if (material[key]) material[key].dispose();
        }
        material.dispose();
      }
    });
  }

  function buildPlacedRetailShelfStock() {
    interior.updateMatrixWorld(true);
    stockGroup.updateMatrixWorld(true);
    const stockWorldQuaternion = stockGroup.getWorldQuaternion(new THREE.Quaternion());
    for (const entry of decorObjs) {
      if (!entry.placementId || entry.group.userData.disposed || !entry.group.userData.loaded) continue;
      const shelfSku = SHOP_CATALOG.find((sku) => sku.id === entry.skuId);
      if (shelfSku?.furnitureCategory !== 'freestanding-shelving') continue;
      const assignments = retailShelfAssignments(state, entry.placementId);
      const storageAssignments = retailShelfStorageAssignments(state, entry.placementId);
      if (!assignments.length && !storageAssignments.length) continue;
      const nodes = entry.group.userData.functionalNodes?.byName || {};
      const display = new THREE.Group();
      display.name = `RetailShelfStock_${entry.placementId}`;
      let productCount = 0;
      let storageProductCount = 0;
      for (const assignment of assignments) {
        const zone = nodes[assignment.zoneName];
        const productSku = SHOP_CATALOG.find((sku) => sku.id === assignment.skuId);
        if (!zone || !productSku) continue;
        zone.updateWorldMatrix(true, false);
        const zoneRoot = new THREE.Group();
        const worldPosition = zone.getWorldPosition(new THREE.Vector3());
        stockGroup.worldToLocal(worldPosition);
        zoneRoot.position.copy(worldPosition);
        const worldQuaternion = zone.getWorldQuaternion(new THREE.Quaternion());
        zoneRoot.quaternion.copy(stockWorldQuaternion).invert().multiply(worldQuaternion);

        const modelScale = shelfSku.modelScale || 1;
        const usableWidth = Math.max(0.18, Number(zone.userData.usable_width_m) * modelScale || 0.50);
        const usableDepth = Math.max(0.16, Number(zone.userData.usable_depth_m) * modelScale || 0.24);
        const clearance = Math.max(0.16, Number(zone.userData.clearance_height_m) * modelScale || 0.28);
        const columns = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(
          assignment.quantity * usableWidth / Math.max(usableDepth, 0.12),
        ))));
        const rows = Math.max(1, Math.ceil(assignment.quantity / columns));
        const cellWidth = usableWidth / columns;
        const cellDepth = usableDepth / rows;
        for (let index = 0; index < assignment.quantity; index++) {
          const built = buildCatalogProductProxy({
            sku: productSku, merch, mats, resources: ownedStockResources,
          });
          const item = built?.root;
          if (!item) continue;
          item.updateMatrixWorld(true);
          const itemBounds = new THREE.Box3().setFromObject(item);
          const itemSize = itemBounds.getSize(new THREE.Vector3());
          const fit = Math.min(
            1,
            cellWidth * 0.76 / Math.max(itemSize.x, 0.02),
            clearance * 0.78 / Math.max(itemSize.y, 0.02),
            cellDepth * 0.72 / Math.max(itemSize.z, 0.02),
          );
          item.scale.multiplyScalar(Math.max(0.18, fit));
          item.updateMatrixWorld(true);
          itemBounds.setFromObject(item);
          const center = itemBounds.getCenter(new THREE.Vector3());
          const column = index % columns;
          const row = Math.floor(index / columns);
          item.position.x += -usableWidth / 2 + cellWidth * (column + 0.5) - center.x;
          item.position.y += -itemBounds.min.y + 0.004;
          item.position.z += -usableDepth / 2 + cellDepth * (row + 0.5) - center.z;
          item.rotation.y += ((index % 3) - 1) * 0.035;
          zoneRoot.add(item);
          productCount++;
        }
        display.add(zoneRoot);
      }
      for (const assignment of storageAssignments) {
        const zone = nodes[assignment.zoneName];
        const productSku = SHOP_CATALOG.find((sku) => sku.id === assignment.skuId);
        if (!zone || !productSku) continue;
        zone.updateWorldMatrix(true, false);
        const zoneRoot = new THREE.Group();
        zoneRoot.name = `CabinetStorage_${assignment.zoneName}`;
        const worldPosition = zone.getWorldPosition(new THREE.Vector3());
        stockGroup.worldToLocal(worldPosition);
        zoneRoot.position.copy(worldPosition);
        const worldQuaternion = zone.getWorldQuaternion(new THREE.Quaternion());
        zoneRoot.quaternion.copy(stockWorldQuaternion).invert().multiply(worldQuaternion);

        const modelScale = shelfSku.modelScale || 1;
        const usableWidth = Math.max(0.18, Number(zone.userData.usable_width_m) * modelScale || 0.50);
        const usableDepth = Math.max(0.16, Number(zone.userData.usable_depth_m) * modelScale || 0.24);
        const clearance = Math.max(0.14, Number(zone.userData.clearance_height_m) * modelScale || 0.22);
        const columns = Math.max(1, Math.min(3, assignment.quantity));
        const rows = Math.max(1, Math.ceil(assignment.quantity / columns));
        const cellWidth = usableWidth / columns;
        const cellDepth = usableDepth / rows;
        for (let index = 0; index < assignment.quantity; index++) {
          const built = buildCatalogProductProxy({
            sku: productSku, merch, mats, resources: ownedStockResources,
          });
          const item = built?.root;
          if (!item) continue;
          item.updateMatrixWorld(true);
          const itemBounds = new THREE.Box3().setFromObject(item);
          const itemSize = itemBounds.getSize(new THREE.Vector3());
          const fit = Math.min(
            1,
            cellWidth * 0.72 / Math.max(itemSize.x, 0.02),
            clearance * 0.72 / Math.max(itemSize.y, 0.02),
            cellDepth * 0.68 / Math.max(itemSize.z, 0.02),
          );
          item.scale.multiplyScalar(Math.max(0.16, fit));
          item.updateMatrixWorld(true);
          itemBounds.setFromObject(item);
          const center = itemBounds.getCenter(new THREE.Vector3());
          const column = index % columns;
          const row = Math.floor(index / columns);
          item.position.x += -usableWidth / 2 + cellWidth * (column + 0.5) - center.x;
          item.position.y += -itemBounds.min.y + 0.004;
          item.position.z += -usableDepth / 2 + cellDepth * (row + 0.5) - center.z;
          zoneRoot.add(item);
          productCount++;
          storageProductCount++;
        }
        display.add(zoneRoot);
      }
      if (!productCount) continue;
      const baked = bakeStockGroup(display);
      baked.name = `retail-shelf:${entry.placementId}`;
      baked.userData.retailShelfStock = {
        displayProductCount: productCount - storageProductCount,
        storageProductCount,
        storageAssignments: storageAssignments.map((assignment) => ({
          zoneName: assignment.zoneName,
          skuId: assignment.skuId,
          quantity: assignment.quantity,
        })),
      };
      stockGroup.add(baked);
      stockMeshes.set(`retail-shelf:${entry.placementId}`, baked);
    }
  }

  function rebuildStock() {
    clearStockFlights();   // any airborne placements land instantly in the bake
    for (const g of stockMeshes.values()) {
      stockGroup.remove(g);
      ownedStockResources.dispose(g);
    }
    stockMeshes.clear();
    reconcileRetailShelfStock(state);
    reconcileRetailShelfStorage(state);
    const inv = state.shop.inventory;
    const reserveLines = SHOP_CATALOG
      .map((sku) => ({ sku, quantity: Math.max(0, inv[sku.id] ? inv[sku.id].back : 0) }))
      .filter((line) => line.quantity > 0);
    const reserveRackOrder = ['backshelf_e2', 'backshelf_e']
      .filter((id) => placedFixtures(state).some((fixture) => fixture.id === id));

    for (const f of activeFixtures(state)) {
      const anchor = fixtureAnchors.get(f.id);
      if (!anchor) continue;

      for (const skuId of f.skus) {
        const sku = SHOP_CATALOG.find((s) => s.id === skuId);
        if (!sku) continue;
        const slots = slotsFor(skuId).map((slot) => resolveAuthoredFixtureSlot(anchor, slot));
        // the shelf cannot hold more than it has places for — the sim enforces the same number,
        // so this min() is a belt, not a braces: it can only ever bite on a corrupted save
        const assignedToPlacedShelves = retailShelfAssignedUnits(state, skuId);
        const fixedFixtureUnits = Math.max(0, (inv[skuId] ? inv[skuId].shelf : 0) - assignedToPlacedShelves);
        // Resolve against the live authored fixture before slicing.  Using the
        // generic slot list a second time here discarded GLB socket transforms,
        // which made cooler bottles and other authored stock float at fallback
        // coordinates even though their real sockets had loaded successfully.
        const defaultCount = Math.min(slots.length, Math.max(0, Math.floor(fixedFixtureUnits)));
        const starterPresentation = starterRetailPresentation(state, skuId, defaultCount);
        const visibleSlots = starterPresentation
          ? starterPresentation.items
            .map((item) => slots[item.slotIndex]
              ? { ...slots[item.slotIndex], starterPresentation: item }
              : null)
            .filter(Boolean)
          : slots.slice(0, defaultCount);
        const count = visibleSlots.length;
        const g = new THREE.Group();
        if (count > 0) {
          const holder = stockHolder(sku, count);
          if (holder) g.add(holder);
          for (let i = 0; i < count; i++) {
            const item = makePresentedStockItem(sku, visibleSlots[i], i);
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

        // While carrying the correct line, show the ONE next authored slot. It
        // communicates valid target and remaining room without faking inventory.
        const held = carriedGoods(state);
        if (held && held.skuId === skuId && count < slots.length) {
          const nextStarterItem = starterRetailPresentation(state, skuId, count + 1)?.items[count];
          const s = nextStarterItem && slots[nextStarterItem.slotIndex]
            ? slots[nextStarterItem.slotIndex]
            : slots[count];
          const preview = new THREE.Group();
          const shape = sku.cat === 'clubs'
            ? new THREE.BoxGeometry(0.10, Math.max(0.65, s.len || 0.8), 0.10)
            : new THREE.BoxGeometry(0.18, 0.18, 0.14);
          const ghost = new THREE.Mesh(shape, STOCK_PREVIEW_MAT);
          ghost.position.set(s.x, sku.cat === 'clubs' ? s.y + (s.len || 0.8) / 2 : s.y, s.z);
          ghost.rotation.z = sku.cat === 'clubs' ? -(s.lean || 0) : 0;
          preview.add(ghost);
          preview.position.copy(anchor.position);
          preview.rotation.copy(anchor.rotation);
          stockGroup.add(preview);
          stockMeshes.set(f.id + ':' + skuId + ':preview', preview);
        }
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

      // Supplier tier 3 is a visible room transformation: the reserved glass
      // cabinet gains curated hero samples and the putting mat gains a demo club.
      if (f.kind === 'premiumcase' && state.shop.unlockedTier >= 3) {
        const g = new THREE.Group();
        const hero = [
          ['head_driver', -0.70, 0.80, -0.22],
          ['rangefinder', 0.02, 0.84, -0.10],
          ['shoe_pro', 0.68, 0.82, 0.22],
          ['cap_pro', -0.53, 1.47, -0.12],
          ['glove', 0.48, 1.46, 0.18],
        ];
        for (const [name, x, y, ry] of hero) {
          const obj = ['rangefinder', 'shoe_pro', 'cap_pro'].includes(name)
            ? merch.instantiateRaw(name) : merch.instantiate(name, { tint: 0x1f4a26 });
          if (!obj) continue;
          // The small electronics and glove now sit on deliberate green
          // presentation cards instead of floating as a blue box and white
          // silhouette against glass.
          if (name === 'rangefinder' || name === 'glove') {
            const card = new THREE.Mesh(
              new THREE.BoxGeometry(name === 'rangefinder' ? 0.40 : 0.34, name === 'rangefinder' ? 0.24 : 0.36, 0.025),
              mats.feltGreen,
            );
            card.position.set(x, y + (name === 'glove' ? 0.01 : 0.07), -0.07);
            g.add(card);
          }
          obj.position.set(x, y, 0.015);
          obj.rotation.y = ry;
          if (name === 'glove') obj.rotation.z = -0.10;
          const scale = name === 'head_driver' ? 2.05
            : name === 'rangefinder' ? 1.35
              : name === 'glove' ? 1.18 : 1.38;
          obj.scale.multiplyScalar(scale);
          g.add(obj);
        }
        const baked = merch.bake(g);
        baked.name = `${f.id}:premium`;
        baked.position.copy(anchor.position);
        baked.rotation.copy(anchor.rotation);
        stockGroup.add(baked);
        stockMeshes.set(f.id + ':premium', baked);
      }

      if (f.kind === 'demo' && state.shop.unlockedTier >= 3) {
        const g = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const ball = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 7), mats.merchWhite);
          ball.position.set(0.95 + i * 0.18, 0.065, 0.18 - i * 0.08);
          g.add(ball);
        }
        const baked = merch.bake(g);
        baked.position.copy(anchor.position);
        baked.rotation.copy(anchor.rotation);
        stockGroup.add(baked);
        stockMeshes.set(f.id + ':demo', baked);
      }

      if (f.kind === 'demorack' && state.shop.unlockedTier >= 3) {
        const g = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const club = makeStockItem(
            SHOP_CATALOG.find((s) => s.id === ['putter1', 'putter2', 'putter3'][i]),
            { x: -0.17 + i * 0.17, y: 0.16, z: 0.02, len: 0.82, lean: 0.04, ry: 0 },
            i,
          );
          if (club) g.add(club);
        }
        const baked = merch.bake(g);
        baked.name = `${f.id}:demo-clubs`;
        baked.position.copy(anchor.position);
        baked.rotation.copy(anchor.rotation);
        stockGroup.add(baked);
        stockMeshes.set(f.id + ':demo-clubs', baked);
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
        const cols = f.short ? [-0.31, 0.31] : [-0.66, -0.22, 0.22, 0.66];
        for (let i = 0; i < show; i++) {
          const bx = cols[i % cols.length];
          const levels = f.short ? [0.6455, 1.1455, 1.6455] : [0.8585, 1.3834, 1.9084];
          const by = levels[Math.floor(i / cols.length) % 3];
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
    buildPlacedRetailShelfStock();
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
    const held = carriedGoods(state);
    sig += held ? `:carry:${held.skuId}.${held.qty}` : ':carry:none';
    for (const placement of placedPropertyItems(state)) {
      const assignments = retailShelfAssignments(state, placement.id);
      if (assignments.length) {
        sig += `:retail:${placement.id}:${assignments
          .map((entry) => `${entry.zoneName}.${entry.skuId}.${entry.quantity}`)
          .join(',')}`;
      }
      const stored = retailShelfStorageAssignments(state, placement.id);
      if (stored.length) {
        sig += `:retail-storage:${placement.id}:${stored
          .map((entry) => `${entry.zoneName}.${entry.skuId}.${entry.quantity}`)
          .join(',')}`;
      }
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
  const moteTexture = makeSoftParticleTexture();
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    color: 0xa2937c,
    size: 0.05,
    map: moteTexture,
    transparent: true,
    opacity: 0.82,
    alphaTest: 0.025,
    depthWrite: false,
  }));
  motes.visible = false;
  motes.frustumCulled = false;
  scene.add(motes);
  for (let i = 0; i < MOTES; i++) moteState.push({ t: Math.random(), ox: 0, oz: 0 });

  // Vacuum chunk pops: roughly 1 suction mote in 8 reads as a bigger chunk that flies to the intake
  // and pops with the vacuumPickup one-shot (rate-limited). A separate small Points so the chunk size
  // (2.2x the 0.045 suction mote) is uniform; pre-allocated pool, zero per-frame allocation.
  const CHUNK_N = 8;
  const chunkPos = new Float32Array(CHUNK_N * 3);
  const chunkState = [];
  for (let i = 0; i < CHUNK_N; i++) chunkState.push({ active: false, t: 0, sx: 0, sy: 0, sz: 0, tx: 0, ty: 0, tz: 0 });
  const chunkGeo = new THREE.BufferGeometry();
  chunkGeo.setAttribute('position', new THREE.BufferAttribute(chunkPos, 3));
  const chunkPoints = new THREE.Points(chunkGeo, new THREE.PointsMaterial({
    color: 0x9a8a6c, size: 0.099, map: moteTexture, // 0.045 suction mote x 2.2
    transparent: true, opacity: 0.9, alphaTest: 0.03, depthWrite: false,
  }));
  chunkPoints.name = 'VacuumChunkPops';
  chunkPoints.visible = false;
  chunkPoints.frustumCulled = false;
  scene.add(chunkPoints);
  let chunkSpawnMod = 0;       // 1-in-8 spawn gate
  let chunkPickupCooldown = 0; // rate-limit on the vacuumPickup one-shot

  function spawnVacuumChunk(wx, wz) {
    chunkSpawnMod = (chunkSpawnMod + 1) % 8;
    if (chunkSpawnMod !== 0) return;
    const slot = chunkState.find((c) => !c.active);
    if (!slot) return;
    const a = Math.random() * Math.PI * 2;
    const r = 0.35 + Math.random() * 0.45;
    slot.active = true; slot.t = 0;
    slot.sx = wx + Math.cos(a) * r; slot.sy = floorY + 0.02; slot.sz = wz + Math.sin(a) * r;
    slot.tx = wx; slot.ty = floorY + 0.06; slot.tz = wz; // the intake mouth
    chunkPoints.visible = true;
  }

  function updateVacuumChunks(dt) {
    if (chunkPickupCooldown > 0) chunkPickupCooldown -= dt;
    let anyActive = false;
    for (let i = 0; i < CHUNK_N; i++) {
      const c = chunkState[i];
      const o = i * 3;
      if (!c.active) { chunkPos[o] = 0; chunkPos[o + 1] = -999; chunkPos[o + 2] = 0; continue; }
      c.t = Math.min(1, c.t + dt * 4.2); // ~0.24 s flight into the mouth
      const e = c.t * c.t;               // accelerate as it is drawn in
      chunkPos[o] = c.sx + (c.tx - c.sx) * e;
      chunkPos[o + 1] = c.sy + (c.ty - c.sy) * e + Math.sin(c.t * Math.PI) * 0.06;
      chunkPos[o + 2] = c.sz + (c.tz - c.sz) * e;
      if (c.t >= 1) {
        c.active = false; // pop at the intake
        if (chunkPickupCooldown <= 0 && hooks.sfx) { hooks.sfx('vacuumPickup'); chunkPickupCooldown = 0.14; }
      } else anyActive = true;
    }
    chunkGeo.attributes.position.needsUpdate = true;
    if (!anyActive) chunkPoints.visible = false;
  }

  let cleanClock = 0;
  let moteFade = 0;

  function showCleaningMotes(kind, wx, wz, dirX = 0, dirZ = 0, dt = 0.016, surface = null, amount = 0) {
    const styles = {
      suction: { color: 0xb7a88c, size: 0.045 },
      sweep: { color: 0x9f8a68, size: 0.052 },
      mop: { color: 0xb9dddf, size: 0.040 },
      cloth: { color: 0xb8ddca, size: 0.032 },
      sponge: { color: 0xf0eee1, size: 0.038 },
    };
    let style = styles[kind] || styles.sweep;
    // Phase 6: sweep motes answer the surface being worked — carpet kicks
    // pale fibre fluff, boards kick dry grit. The caller supplies the surface
    // (it owns the gate's LOCAL point; cleaningSurfaceAt is local-frame), and
    // only the broom's kind consults the one tuning file, so every other tool
    // keeps its authored style untouched.
    let sizeScale = 1;
    if (kind === 'sweep' && surface) {
      style = BROOM_FEEL.particles.surface[surface] || style;
    }
    if (kind === 'sweep') {
      // the kick scales with how much debris the stroke ACTUALLY moved — an
      // empty pass barely dusts, a loaded pile kicks visibly
      const pc = BROOM_FEEL.particles;
      sizeScale = Math.max(pc.sizeMin, Math.min(pc.sizeMax, Math.sqrt((amount || 0) / pc.amountRef)));
    }
    motes.material.color.set(style.color);
    motes.material.size = style.size * sizeScale;
    motes.visible = true;
    moteFade = 0.16;
    const uxLen = Math.hypot(dirX, dirZ) || 1;
    const ux = dirX / uxLen;
    const uz = dirZ / uxLen;
    for (let i = 0; i < MOTES; i++) {
      const m = moteState[i];
      m.t += dt * (kind === 'suction' ? 2.8 : 1.8 + (i % 4) * 0.11);
      if (m.t >= 1 || !Number.isFinite(m.ox)) {
        m.t %= 1;
        m.ox = (Math.random() - 0.5) * 0.78;
        m.oz = (Math.random() - 0.5) * 0.78;
      }
      const t = m.t;
      const o = i * 3;
      if (kind === 'suction') {
        const ease = t * t;
        motePos[o] = wx + m.ox * (1 - ease);
        motePos[o + 1] = floorY + 0.025 + Math.sin(t * Math.PI) * 0.07;
        motePos[o + 2] = wz + m.oz * (1 - ease);
      } else {
        motePos[o] = wx + m.ox * 0.34 + ux * t * 0.24;
        motePos[o + 1] = floorY + 0.025 + Math.sin(t * Math.PI) * (kind === 'sweep' ? 0.15 : 0.07);
        motePos[o + 2] = wz + m.oz * 0.34 + uz * t * 0.24;
      }
    }
    moteGeo.attributes.position.needsUpdate = true;
    if (kind === 'suction') spawnVacuumChunk(wx, wz);
  }

  // --- loose debris: swept into piles, then carried away ------------------------------------
  //
  // The floor grime mask handles ground-in dirt. Debris is the other half — leaves, grit and
  // wrappers that a broom PUSHES rather than erases. Piles are drawn as small instanced clumps
  // whose scale tracks the cluster amount, so a heap you have worked twice visibly reads as a heap.
  // The wet and solution fields are authored at 0.25 yd — far finer than the 13x8 (=104 cell)
  // grime grid they sit over, because a wet stripe you can see the edge of is the whole point of
  // mopping. They are new save fields, so unlike the grime grid they carry no migration debt.
  // The wet/solution field is authored around a room rectangle. Under shed it is
  // the shed's own footprint so the gloss plane matches the walls and mop
  // puddles land where you mopped. The recipe leaves reno.wet unseeded, so
  // re-sizing the grid here carries no save-migration debt.
  const cleaningRoom = shedPresentation ? { w: SHED_ROOM.w, d: SHED_ROOM.d } : RENO.room;
  const WET_GRID = wetGridForRoom(cleaningRoom);
  // cleanGrimeAt works in room-CENTRED yards; the wet field is indexed from its corner.
  const toWet = (lx, lz) => ({ x: lx + cleaningRoom.w / 2, z: lz + cleaningRoom.d / 2 });

  ensureDebris(state);
  ensureWet(state, WET_GRID.w, WET_GRID.h);
  ensureCleaningToolState(state);
  if (debrisState(state).length === 0 && !state.shop.reno.debrisSeeded) {
    // a property nobody has run for two years does not have a clean floor
    seedDebris(state, 30, SHELL.w - 3, SHELL.d - 3, 20260718);
    state.shop.reno.debrisSeeded = true;
  }

  const DEBRIS_CAP = 96;
  // Indoor grit must remain readable enough to sweep without resembling
  // landscaping stones. A smaller, strongly flattened clump reads as tracked
  // gravel/dried mud while preserving the simulation-owned pile amount.
  const debrisGeo = new THREE.DodecahedronGeometry(0.045, 0);
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x6b5a3c, roughness: 0.95 });
  const debrisMesh = new THREE.InstancedMesh(debrisGeo, debrisMat, DEBRIS_CAP);
  debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  debrisMesh.castShadow = false;
  debrisMesh.receiveShadow = false;
  debrisMesh.frustumCulled = false;
  debrisMesh.count = 0;
  debrisMesh.name = 'DebrisGritInstances'; // sim visual — kept visible by the shed whitelist
  interior.add(debrisMesh);
  const litterGeo = new THREE.BoxGeometry(0.16, 0.018, 0.10, 2, 1, 2);
  const litterMat = new THREE.MeshStandardMaterial({ color: 0xb8a477, roughness: 0.9 });
  const litterMesh = new THREE.InstancedMesh(litterGeo, litterMat, DEBRIS_CAP);
  const litterColors = [0xb79a62, 0x8b9272, 0x9b6f55].map((hex) => new THREE.Color(hex));
  litterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  litterMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DEBRIS_CAP * 3), 3);
  litterMesh.castShadow = false;
  litterMesh.receiveShadow = false;
  litterMesh.frustumCulled = false;
  litterMesh.count = 0;
  litterMesh.name = 'DebrisLitterInstances'; // sim visual — kept visible by the shed whitelist
  interior.add(litterMesh);

  const _dm = new THREE.Matrix4();
  const _dq = new THREE.Quaternion();
  const _dp = new THREE.Vector3();
  const _ds = new THREE.Vector3();
  const _dUp = new THREE.Vector3(0, 1, 0);
  const _dRight = new THREE.Vector3(1, 0, 0);
  let wetVisualDirty = false;
  let wetRepaintClock = 0;
  function refreshDebrisVisual() {
    const list = debrisState(state);
    let gritCount = 0;
    let litterCount = 0;
    for (let i = 0; i < list.length && gritCount + litterCount < DEBRIS_CAP * 2; i++) {
      const d = list[i];
      // a pile spreads as it grows rather than becoming one giant pebble
      const s = Math.min(2.4, 0.55 + Math.sqrt(d.a) * 1.5);
      // The `interior` group is already at floor height — dirt.js lays its grime overlay at a
      // plain 0.026. Adding FLOOR_TOP here floated every pile 0.3 yd off the boards.
      _dp.set(d.x, 0.012 * s, d.z);
      _dq.setFromAxisAngle(_dUp, (d.x * 7.3 + d.z * 3.1) % Math.PI);
      const litter = d.kind === 'litter';
      _ds.set(litter ? s * 1.25 : s, litter ? s * 0.65 : s * 0.22, litter ? s * 1.10 : s);
      _dm.compose(_dp, _dq, _ds);
      if (litter && litterCount < DEBRIS_CAP) {
        litterMesh.setMatrixAt(litterCount, _dm);
        const hue = (Math.abs(Math.floor(d.x * 7 + d.z * 13)) % 3);
        litterMesh.setColorAt(litterCount, litterColors[hue]);
        litterCount++;
      } else if (!litter && gritCount < DEBRIS_CAP) {
        debrisMesh.setMatrixAt(gritCount++, _dm);
      }
    }
    debrisMesh.count = gritCount;
    litterMesh.count = litterCount;
    debrisMesh.instanceMatrix.needsUpdate = true;
    litterMesh.instanceMatrix.needsUpdate = true;
    if (litterMesh.instanceColor) litterMesh.instanceColor.needsUpdate = true;
  }
  refreshDebrisVisual();

  // --- DIRT SENSE: where is the mess? ---------------------------------------------------------
  //
  // Play-test: "I cannot tell what still needs cleaning… Shop condition 9 —
  // filthy tells me a number but never where." House Flipper 2 answers this with
  // Flipper Sense (hold a key, remaining dirt lights up), and the documented
  // criticism of it is that it only shows what you are ALREADY looking at. The
  // first game's minimap was better for direction. So there are two consumers of
  // this overlay: the held-key reveal, and the Tab overview camera, which sees
  // the whole floor at once and therefore answers "which way do I go".
  //
  // The markers deliberately draw THROUGH geometry (depthTest off, late render
  // order) — a pile behind the counter is exactly the one you cannot find.
  //
  // D3: AND IT ANSWERS THE TOOL IN YOUR HANDS.
  //
  // The reveal used to light the debris clusters and nothing else, for every
  // tool equally. That is wrong in both directions: a player holding a mop was
  // shown piles the mop cannot touch, and a player holding anything at all was
  // never shown the ground-in grime, which is the larger half of a filthy floor
  // and has no other tell. Markers are now per-MEDIUM (cleaningTools.js
  // MEDIUM), coloured by what kind of mess they are, and filtered to what the
  // held tool can actually shift. With no cleaning tool out, everything shows —
  // that is the "which way do I go" case the Tab overview wants.
  const SENSE_CAP = DEBRIS_CAP * 2 + RENO.grid.w * RENO.grid.h;
  const senseGeo = new THREE.SphereGeometry(0.16, 10, 8);
  const senseMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, // white: the per-instance colour carries the medium
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  // J1: THE REVEAL SHOWS THE OBJECT, NOT A MARKER (first-person mode).
  //
  // "Blue circles and flat orange patches tell me where something is, not
  // what it is." So on foot the reveal now draws THE THINGS THEMSELVES:
  //  - each debris pile as a ghost of its own geometry (the grit clump / the
  //    litter slab, scaled a rim wider so it haloes the real mesh), through
  //    walls, in the medium's legend colour;
  //  - each dirty grime cell as a flat quad fitted to the CELL'S OWN
  //    footprint on the boards — the stain's real shape and extent, not a
  //    hovering ball.
  // The sphere markers stay for the Tab overview's column mode, where a
  // silhouette on the floor is invisible from above the roof and a pillar is
  // the honest answer.
  const senseGhostMatFor = (hex) => new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const senseGhostGritMat = senseGhostMatFor(MEDIUM_STYLE[MEDIUM.DEBRIS].color);
  const senseGhostLitterMat = senseGhostMatFor(MEDIUM_STYLE[MEDIUM.DEBRIS].color);
  const senseGrimeQuadMat = senseGhostMatFor(MEDIUM_STYLE[MEDIUM.GRIME].color);
  const GRIME_MARKER_MAX_CAP = 20; // mirrors GRIME_MARKER_MAX below
  const senseGhostGrit = new THREE.InstancedMesh(debrisGeo, senseGhostGritMat, DEBRIS_CAP);
  const senseGhostLitter = new THREE.InstancedMesh(litterGeo, senseGhostLitterMat, DEBRIS_CAP);
  // 2026-08-06 ruling: the reveal must pick out "the specific mess", not "the
  // huge blob". One filled quad per grid cell was the blob - a cell is over a
  // metre across, so a dirty floor lit up as a wall of solid tiles that said
  // nothing a condition number does not. Grime is now drawn as SPECKLES
  // scattered inside each cell, as many as the cell is dirty, which reads as
  // the actual patches of muck on the boards.
  const GRIME_SPECKLES_PER_CELL = 9;
  const senseGrimeQuad = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1), senseGrimeQuadMat,
    GRIME_MARKER_MAX_CAP * GRIME_SPECKLES_PER_CELL,
  );
  for (const ghost of [senseGhostGrit, senseGhostLitter, senseGrimeQuad]) {
    ghost.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    ghost.castShadow = false;
    ghost.receiveShadow = false;
    ghost.frustumCulled = false;
    ghost.count = 0;
    ghost.visible = false;
    ghost.renderOrder = 40; // after the world, with the markers
    interior.add(ghost);
  }
  senseGhostGrit.name = 'DirtSenseGhostGrit';
  senseGhostLitter.name = 'DirtSenseGhostLitter';
  senseGrimeQuad.name = 'DirtSenseGrimeCells';
  // Loose debris keeps the established cyan; grime is a warm ochre, because it
  // is the colour of the thing itself and because the two must be tellable
  // apart at a glance and through a wall.
  // J2: the marker colours come from the ONE legend authority, so the mesh,
  // the HUD chips and the reticle name the same medium the same way. (They
  // used to be hand-typed here — blue circles for debris, orange for grime —
  // which is exactly the "tells me where, not what" the review of the reveal
  // called out.)
  const SENSE_COLOR = {
    [MEDIUM.DEBRIS]: new THREE.Color(MEDIUM_STYLE[MEDIUM.DEBRIS].color),
    [MEDIUM.GRIME]: new THREE.Color(MEDIUM_STYLE[MEDIUM.GRIME].color),
  };
  const senseMesh = new THREE.InstancedMesh(senseGeo, senseMat, SENSE_CAP);
  senseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  senseMesh.frustumCulled = false;
  senseMesh.renderOrder = 998;
  senseMesh.castShadow = false;
  senseMesh.receiveShadow = false;
  senseMesh.count = 0;
  senseMesh.visible = false;
  senseMesh.name = 'DirtSenseMarkers';
  interior.add(senseMesh);

  let senseAlpha = 0;
  let senseColumns = false;
  let senseTool = null;
  const senseTally = { debris: 0, grime: 0, hiddenByTool: 0 };

  // Grime lives on a coarse cell grid rather than as clusters, so a marker
  // stands at the centre of any cell still carrying enough to be worth a pass.
  // Below this the floor reads clean and a marker would be noise.
  const GRIME_MARKER_MIN = 0.06;
  // …and on a day-one floor EVERY cell is over that threshold. Marking all 104
  // of them wallpapered the room in orange spheres — technically true, and
  // useless: "the whole floor is dirty" is what the condition number already
  // says. The reveal's job is WHERE TO GO FIRST, so it shows the worst patches
  // only. 20 is roughly a fifth of the grid: enough to describe the shape of
  // the mess, few enough to see the room through.
  const GRIME_MARKER_MAX = GRIME_MARKER_MAX_CAP;
  // Debris is a pile you walk up to; grime is IN the boards. Drawing both as
  // the same floating ball made a stained floor look like hovering fruit, so
  // grime markers are flattened onto the surface and read as a stain.
  const GRIME_FLATTEN = 0.14;

  function refreshDirtSense() {
    const media = senseTool ? toolMedia(senseTool) : [MEDIUM.DEBRIS, MEDIUM.GRIME];
    const wantDebris = media.includes(MEDIUM.DEBRIS);
    const wantGrime = media.includes(MEDIUM.GRIME);
    const kinds = senseTool ? toolDebrisKinds(senseTool) : null;
    const COLUMN_YD = 9.0;
    let n = 0;
    let ghostGrit = 0;
    let ghostLitter = 0;
    let grimeQuads = 0;
    senseTally.debris = 0;
    senseTally.grime = 0;
    senseTally.hiddenByTool = 0;

    // columns mode keeps the sphere pillars — from above the roof a
    // silhouette on the boards is invisible and the pillar is the answer
    const place = (x, z, s, medium) => {
      const h = COLUMN_YD / (0.16 * 2);
      _dp.set(x, COLUMN_YD / 2, z);
      _dq.identity();
      _ds.set(s, h, s);
      _dm.compose(_dp, _dq, _ds);
      senseMesh.setMatrixAt(n, _dm);
      senseMesh.setColorAt(n, SENSE_COLOR[medium]);
      n += 1;
    };

    const list = debrisState(state);
    for (let i = 0; i < list.length; i += 1) {
      const d = list[i];
      if (!d || d.a <= 0.001) continue;
      if (!wantDebris || (kinds && !kinds.includes(d.kind))) { senseTally.hiddenByTool += 1; continue; }
      const s = Math.min(2.6, 0.7 + Math.sqrt(d.a) * 1.7);
      if (senseColumns) {
        if (n < SENSE_CAP) place(d.x, d.z, s, MEDIUM.DEBRIS);
      } else {
        // J1: the pile ITSELF, ghosted — same matrix family refreshDebrisVisual
        // composes for the drawn clump, scaled a rim wider so the glow haloes
        // the real mesh and reads as the object's own silhouette.
        const vs = Math.min(2.4, 0.55 + Math.sqrt(d.a) * 1.5) * 1.30;
        _dp.set(d.x, 0.012 * vs, d.z);
        _dq.setFromAxisAngle(_dUp, (d.x * 7.3 + d.z * 3.1) % Math.PI);
        const litter = d.kind === 'litter';
        _ds.set(litter ? vs * 1.25 : vs, litter ? vs * 0.65 : vs * 0.22, litter ? vs * 1.10 : vs);
        _dm.compose(_dp, _dq, _ds);
        if (litter && ghostLitter < DEBRIS_CAP) senseGhostLitter.setMatrixAt(ghostLitter++, _dm);
        else if (!litter && ghostGrit < DEBRIS_CAP) senseGhostGrit.setMatrixAt(ghostGrit++, _dm);
      }
      senseTally.debris += 1;
    }

    const grime = state.shop?.reno?.grime;
    if (grime) {
      const cellW = RENO.room.w / RENO.grid.w;
      const cellD = RENO.room.d / RENO.grid.h;
      const dirty = [];
      for (let cy = 0; cy < RENO.grid.h; cy += 1) {
        for (let cx = 0; cx < RENO.grid.w; cx += 1) {
          const amount = grime[cy * RENO.grid.w + cx];
          if (!(amount > GRIME_MARKER_MIN)) continue;
          if (!wantGrime) { senseTally.hiddenByTool += 1; continue; }
          dirty.push({ cx, cy, amount });
        }
      }
      // Worst first, then truncate — so as the floor gets cleaner the markers
      // stop being a wall and start being a to-do list, and the last few to
      // survive are genuinely the last few patches left.
      dirty.sort((a, b) => b.amount - a.amount);
      for (const cell of dirty.slice(0, GRIME_MARKER_MAX)) {
        const x = -RENO.room.w / 2 + (cell.cx + 0.5) * cellW;
        const z = -RENO.room.d / 2 + (cell.cy + 0.5) * cellD;
        if (senseColumns) {
          if (n < SENSE_CAP) {
            place(x, z, Math.min(2.6, 0.7 + Math.sqrt(cell.amount) * 1.7), MEDIUM.GRIME);
          }
        } else {
          // THE SPECIFIC MESS, not a lit tile. Scatter small speckles inside
          // the cell - more of them, and larger, the dirtier the cell is - so
          // the reveal reads like grime seen through the boards rather than a
          // highlighted square. The scatter is a deterministic hash of the
          // cell, so the same floor shows the same patches every boot.
          const count = Math.max(2, Math.round(
            2 + Math.min(1, cell.amount) * (GRIME_SPECKLES_PER_CELL - 2),
          ));
          let h = (cell.cx * 73856093) ^ (cell.cy * 19349663);
          const rand = () => {
            h = Math.imul(h ^ (h >>> 15), h | 1);
            h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
            return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
          };
          for (let s = 0; s < count && grimeQuads < senseGrimeQuad.instanceMatrix.count; s += 1) {
            // a speckle never grows past a third of its cell, so no single
            // mark can read as a slab however dirty the cell is
            const size = (0.10 + rand() * 0.12) * Math.min(cellW, cellD)
              * (0.75 + Math.min(1, cell.amount) * 0.45);
            _dp.set(
              x + (rand() - 0.5) * cellW * 0.82,
              0.035,
              z + (rand() - 0.5) * cellD * 0.82,
            );
            _dq.setFromAxisAngle(_dRight, -Math.PI / 2);
            _ds.set(size, size * (0.75 + rand() * 0.35), 1);
            _dm.compose(_dp, _dq, _ds);
            senseGrimeQuad.setMatrixAt(grimeQuads++, _dm);
          }
        }
        senseTally.grime += 1;
      }
      senseTally.grimeCellsDirty = dirty.length;
    }

    senseMesh.count = n;
    senseMesh.instanceMatrix.needsUpdate = true;
    if (senseMesh.instanceColor) senseMesh.instanceColor.needsUpdate = true;
    senseGhostGrit.count = ghostGrit;
    senseGhostLitter.count = ghostLitter;
    senseGrimeQuad.count = grimeQuads;
    senseGhostGrit.instanceMatrix.needsUpdate = true;
    senseGhostLitter.instanceMatrix.needsUpdate = true;
    senseGrimeQuad.instanceMatrix.needsUpdate = true;
  }

  /**
   * Show remaining dirt. `alpha` 0 hides it entirely (and costs nothing);
   * `columns` stands each marker into a tall pillar for the overview camera,
   * where a floor-hugging blob is invisible from above the roof.
   */
  // C5 (Goal 18): the register freezes the walk update, so courseScene's
  // per-frame stationOpen zeroing never runs while the till is up — a reveal
  // lit at the moment of entry stayed lit behind the UI. The register mode
  // zeroes it at the entry transition through this handle.
  B.setDirtReveal = (...args) => setDirtReveal(...args);
  function setDirtReveal(alpha, columns = false, toolId = null) {
    const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 0));
    const tool = CLEANING_TOOLS[toolId] ? toolId : null;
    const modeChanged = columns !== senseColumns || tool !== senseTool;
    senseColumns = !!columns;
    senseTool = tool;
    senseAlpha = a;
    const on = a > 0.002;
    // columns mode = pillars; on foot = the objects themselves (J1)
    senseMesh.visible = on && senseColumns;
    senseMat.opacity = a * 0.5;
    senseGhostGrit.visible = on && !senseColumns;
    senseGhostLitter.visible = on && !senseColumns;
    senseGrimeQuad.visible = on && !senseColumns;
    senseGhostGritMat.opacity = a * 0.85;
    senseGhostLitterMat.opacity = a * 0.85;
    senseGrimeQuadMat.opacity = a * 0.5;
    if (on && (modeChanged || a > 0)) refreshDirtSense();
  }

  /** The nearest remaining cluster to a world point, for the reticle prompt. */
  function nearestDebrisLocal(lx, lz, radius) {
    const list = debrisState(state);
    let best = null;
    let bestD2 = radius * radius;
    for (const d of list) {
      if (!d || d.a <= 0.001) continue;
      const dx = d.x - lx;
      const dz = d.z - lz;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bestD2) { bestD2 = d2; best = d; }
    }
    return best ? { x: best.x, z: best.z, amount: best.a, kind: best.kind, dist: Math.sqrt(bestD2) } : null;
  }

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
    new THREE.PlaneGeometry(cleaningRoom.w, cleaningRoom.d),
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
  wetPlane.name = 'WetFloorOverlay'; // sim visual — kept visible by the shed whitelist
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

  const pointInCollider = (x, z, collider, margin = 0) => {
    if (collider.minX !== undefined) {
      return x >= collider.minX - margin && x <= collider.maxX + margin
        && z >= collider.minZ - margin && z <= collider.maxZ + margin;
    }
    if (Number.isFinite(collider.x) && Number.isFinite(collider.z) && Number.isFinite(collider.r)) {
      return Math.hypot(x - collider.x, z - collider.z) <= collider.r + margin;
    }
    return false;
  };

  // Slab intersection in the horizontal plane. The endpoint is shortened very slightly so a
  // tool touching the near face of a counter is legal while a socket behind it is not.
  function segmentHitsCollider(ax, az, bx, bz, collider) {
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) return pointInCollider(bx, bz, collider, 0.02);
    const endT = Math.max(0, 1 - 0.035 / length);
    if (collider.minX === undefined) {
      const steps = Math.max(2, Math.ceil(length / 0.08));
      for (let i = 1; i <= steps; i++) {
        const t = endT * (i / steps);
        if (pointInCollider(ax + dx * t, az + dz * t, collider, 0.025)) return true;
      }
      return false;
    }
    let t0 = 0;
    let t1 = endT;
    for (const [p, q] of [
      [-dx, ax - collider.minX], [dx, collider.maxX - ax],
      [-dz, az - collider.minZ], [dz, collider.maxZ - az],
    ]) {
      if (Math.abs(p) < 1e-8) {
        if (q < 0) return false;
        continue;
      }
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
    return t0 <= endT && t1 >= 0;
  }

  function cleaningSurfaceAt(lx, lz) {
    if (shedPresentation) return 'hard-floor'; // the shed is bare concrete; no clubhouse rugs
    if (Math.abs(lx - LOGO_RUG.x) <= LOGO_RUG.w / 2
      && Math.abs(lz - LOGO_RUG.z) <= LOGO_RUG.d / 2) return 'carpet';
    // The furnished lounge rug is permanent even before its premium decor replacement arrives.
    if (Math.abs(lx - LOUNGE.rug.x) <= 1.5 && Math.abs(lz - LOUNGE.rug.z) <= 1.15) return 'carpet';
    for (const entry of state.shop.reno.decor || []) {
      if (entry.skuId !== 'rug1') continue;
      const spot = DECOR_SPOTS.rug1?.[entry.spot];
      if (spot && Math.abs(lx - spot.x) <= 1.5 && Math.abs(lz - spot.z) <= 1.0) return 'carpet';
    }
    return 'hard-floor';
  }

  function cleaningGate(wx, wz, origin = null) {
    if (!isInside(wx, wz, -0.04)) return { ok: false, reason: 'outside' };
    const local = W2L(wx, wz);
    for (const collider of registeredCols) {
      if (pointInCollider(wx, wz, collider, 0.025)) return { ok: false, reason: 'blocked' };
      if (origin && segmentHitsCollider(origin.x, origin.z, wx, wz, collider)) {
        return { ok: false, reason: 'occluded' };
      }
    }
    return { ok: true, local, surface: cleaningSurfaceAt(local.x, local.z) };
  }

  /** Aim solution at the actual floor hit, with the same collider gate used by contact tools. */
  function cleaningAim(origin, direction, maxDistance = 1.8) {
    if (!origin || !direction || direction.y >= -0.035) return null;
    const t = (floorY + 0.035 - origin.y) / direction.y;
    if (!(t > 0.05) || t > maxDistance) return null;
    const point = new THREE.Vector3(
      origin.x + direction.x * t,
      floorY + 0.035,
      origin.z + direction.z * t,
    );
    const gate = cleaningGate(point.x, point.z, origin);
    return gate.ok ? { point, surface: gate.surface } : { point, blocked: true, reason: gate.reason };
  }

  function recordFloorCleaning(amount, dt) {
    if (!(amount > 0)) return;
    if (state.tutorial) tutorialFlag(state, 'vacuumed');
    cleanClock += Math.max(0, dt || 0);
    if (cleanClock < 0.12) return;
    cleanClock = 0;
    repaintGrime();
    refreshCondition();
  }

  /**
   * One entry point for every cleaning tool. The caller passes the tool's own contact or nozzle
   * point in WORLD space — read from the socket on the viewmodel, never guessed from the camera —
   * plus the direction it is being worked in.
   */
  function cleanWithTool(toolId, wx, wz, dirX, dirZ, dt, options = null) {
    const def = CLEANING_TOOLS[toolId];
    if (!def) return { did: 0, kind: null };
    // Discrete Pine Hills targets accept tool contact BEFORE the floor gate.
    // Wall scuffs, corner cobwebs, and the entry leaves have contact zones
    // against architecture or under furniture footprints — exactly what the
    // gate protects the floor grime/wet systems from, which made those
    // targets unreachable (CLEAN-SCUFF-001). The target map enforces its own
    // per-target radii and tool schedules, so raw contact is safe here, and
    // one forward site serves every tool class.
    {
      const raw = W2L(wx, wz);
      const cleaning = cleaningStatus(state);
      const special = detailInterior ? detailInterior.applyCleaningTool(toolId, raw.x, raw.z, dt, {
        bagSpace: bagSpace(state),
        bagTied: cleaning?.bag?.tied === true,
      }) : { handled: false };
      if (special.handled) {
        if (special.did > 0) {
          if (def.toolClass === TOOL_CLASS.CARRY) addToBag(state, special.did);
          recordCampaignCleaning(state, toolId, special.did);
          refreshCondition();
        }
        const kind = def.toolClass === TOOL_CLASS.CARRY ? 'bag'
          : def.toolClass === TOOL_CLASS.SUCTION ? 'suction'
            : def.toolClass === TOOL_CLASS.SWEEP ? 'sweep'
              : def.id;
        return {
          did: special.did,
          kind,
          targetId: special.targetId,
          blocked: !!special.reason,
          reason: special.reason || null,
        };
      }
    }
    const gate = cleaningGate(wx, wz, options?.origin || null);
    if (!gate.ok) return { did: 0, kind: def.toolClass, blocked: true, reason: gate.reason };
    const l = gate.local;
    let did = 0;
    // EVERY successful tool path must return through here, or the campaign never learns
    // the tool was used. Five of the eight used to return directly and so never recorded
    // (broom, dustpan, vacuum, mop, trash bag), which left the objective's recommended
    // tool stuck on "Push broom"/"Shop vacuum" forever.
    //
    // Attribution only. Grime repainting stays with recordFloorCleaning, which the paths
    // that actually move grime already call — routing the clock through here as well
    // double-ticked it for cloth/sponge and repainted for spray, which touches solution,
    // not grime.
    const finish = (result) => {
      if ((result.did || 0) <= 0) return result;
      recordCampaignCleaning(state, toolId, result.did);
      if (def.toolClass === TOOL_CLASS.SUCTION && state.tutorial) tutorialFlag(state, 'vacuumed');
      return result;
    };

    switch (def.toolClass) {
      case TOOL_CLASS.SWEEP: {
        // a broom moves debris; it never deletes it
        did = sweepAt(state, l.x, l.z, dirX, dirZ, def.radius, dt).moved;
        if (did > 0) refreshDebrisVisual();
        if (did > 0) showCleaningMotes('sweep', wx, wz, dirX, dirZ, dt, cleaningSurfaceAt(l.x, l.z), did);
        return finish({ did, kind: 'sweep' });
      }
      case TOOL_CLASS.SCOOP: {
        const room = panSpace(state);
        if (room <= 0) return { did: 0, kind: 'scoop', blocked: true, reason: 'pan-full' };
        did = collectAt(state, l.x, l.z, def.radius, room);
        if (did > 0) {
          refreshDebrisVisual();
          addToPan(state, did);
          presentRestorationFeedback(syncGenericCleanupMilestone(state));
        }
        return finish({ did, kind: 'scoop', full: panSpace(state) <= 0 });
      }
      case TOOL_CLASS.SUCTION: {
        // debris is drawn in and swallowed only at the mouth; ground-in dust comes up under the head
        did = suckAt(state, l.x, l.z, def.radius, dt);
        if (did > 0) presentRestorationFeedback(syncGenericCleanupMilestone(state));
        const dust = cleanGrimeAt(state, l.x, l.z, 0.5 * dt);
        presentRestorationFeedback(dust.restoration);
        if (did > 0) refreshDebrisVisual();
        if (did + dust.cleaned > 0) showCleaningMotes('suction', wx, wz, 0, 0, dt);
        recordFloorCleaning(did + dust.cleaned, dt);
        return finish({ did: did + dust.cleaned, kind: 'suction', picked: did > 0 });
      }
      case TOOL_CLASS.STROKE: {
        if (def.id === 'mop') {
          if (gate.surface === 'carpet') {
            return { did: 0, kind: 'mop', blocked: true, reason: 'carpet' };
          }
          const charge = consumeMopCharge(state, dt, def.strength);
          if (charge.used <= 0) return { did: 0, kind: 'mop', blocked: true, reason: 'mop-dry' };
          const res = cleanGrimeAt(
            state, l.x, l.z, def.strength * charge.efficacy * 0.55 * charge.used,
          );
          presentRestorationFeedback(res.restoration);
          const wp = toWet(l.x, l.z);
          wetAt(state, WET_GRID, wp.x, wp.z, def.radius, charge.used * 1.6);
          // Elongated wet sheen: two lighter stamps trailing along the stroke direction so a
          // mopped stripe reads as a wet smear, not a disc. Same wetAt field — no new system.
          const sheen = charge.used * 0.9;
          wetAt(state, WET_GRID, wp.x + dirX * 0.16, wp.z + dirZ * 0.16, def.radius * 0.7, sheen);
          wetAt(state, WET_GRID, wp.x + dirX * 0.30, wp.z + dirZ * 0.30, def.radius * 0.55, sheen * 0.7);
          wetVisualDirty = true;
          if (res.cleaned > 0) showCleaningMotes('mop', wx, wz, dirX, dirZ, dt);
          recordFloorCleaning(res.cleaned, dt);
          return finish({ did: res.cleaned, kind: 'mop', charge: charge.charge });
        }
        // cloth and sponge: the cloth only lifts what the spray has already loosened
        const wp = toWet(l.x, l.z);
        const sol = solutionLevel(state, WET_GRID, wp.x, wp.z);
        if (def.needsSolution && sol < SOLUTION_MIN) return { did: 0, kind: 'dry', blocked: true };
        const gain = def.needsSolution ? 1 : 0.55 + sol * 0.8;
        const res = cleanGrimeAt(state, l.x, l.z, def.strength * gain * 0.5 * dt);
        presentRestorationFeedback(res.restoration);
        if (res.cleaned > 0) {
          consumeSolution(state, WET_GRID, wp.x, wp.z, def.radius, dt * 0.5);
          wetVisualDirty = true;
          showCleaningMotes(def.id, wx, wz, dirX, dirZ, dt);
          recordFloorCleaning(res.cleaned, dt);
        }
        return finish({ did: res.cleaned, kind: def.id });
      }
      case TOOL_CLASS.SPRAY: {
        const sp = toWet(l.x, l.z);
        did = solutionAt(state, WET_GRID, sp.x, sp.z, def.radius, dt * 2.2);
        wetVisualDirty = true;
        return finish({ did, kind: 'spray' });
      }
      case TOOL_CLASS.CARRY: {
        const status = cleaningStatus(state);
        if (status.bag.tied) return { did: 0, kind: 'bag', blocked: true, reason: 'bag-tied' };
        const room = bagSpace(state);
        if (room <= 0) return { did: 0, kind: 'bag', blocked: true, reason: 'bag-full' };
        did = collectAt(state, l.x, l.z, def.radius, room, (cluster) => cluster.kind === 'litter');
        if (did > 0) {
          refreshDebrisVisual();
          addToBag(state, did);
          presentRestorationFeedback(syncGenericCleanupMilestone(state));
        }
        return finish({ did, kind: 'bag', full: bagSpace(state) <= 0 });
      }
      default:
        return { did: 0, kind: null };
    }
  }

  function vacuumAt(wx, wz, dt) {
    const l = W2L(wx, wz);
    const res = cleanGrimeAt(state, l.x, l.z, 0.5 * dt);
    presentRestorationFeedback(res.restoration);
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
    if (cx < 0 || cx >= RENO.grid.w || cy < 0 || cy >= RENO.grid.h) return 'Vacuum - aim at the floor';
    const d = reno.grime[cy * RENO.grid.w + cx];
    return d > 0.05 ? `Vacuum - this patch: ${Math.round(d * 100)}% dirty · hold LMB` : 'Vacuum - this patch is clean';
  }

  function emptyDustpanIntoBag() {
    // reno.pan/reno.bag are legacy mirrors that ensureCleaningToolState
    // rewrites from the structured authority every sync; writing the mirrors
    // directly (the pre-authority behavior) made this verb a visual no-op.
    const result = emptyPanIntoBag(state);
    if (result.moved > 0) tutorialFlag(state, 'panEmptied');
    return result.moved;
  }

  function disposeCleaningBag() {
    // One deliberate E ties the bag and discards it; disposal is legal only
    // after tying, and the holder receives a fresh empty bag.
    tieBag(state);
    const result = disposeTiedBag(state);
    if (result.ok) tutorialFlag(state, 'trashBagDisposed');
    return result.ok ? result.disposed : 0;
  }

  // Asset 80 marks the cleaning-bay disposal point. Debris loads have always
  // been conserved, but they previously had no normal-control world verb for
  // returning to zero. Two explicit E presses preserve the physical sequence:
  // empty the pan into the bag, then tie and discard the bag.
  if (!shedPresentation) { // the shed's own disposal station arrives in a later task
    const disposalWorld = L2W(7.70, 1.20);
    addProp({
      x: disposalWorld.x,
      z: disposalWorld.z,
      r: 1.55,
      focusBias: 0.12,
      label: () => {
        const pan = state.shop.reno.pan || 0;
        const bag = state.shop.reno.bag || 0;
        if (pan > 0) return 'Cleaning disposal - [E] empty the dustpan into the trash bag';
        if (bag > 0) return 'Cleaning disposal - [E] tie and discard the filled trash bag';
        return null;
      },
      action: () => {
        const pan = emptyDustpanIntoBag();
        if (pan > 0) {
          if (hooks.sfx) hooks.sfx('disposal');
          if (hooks.toast) hooks.toast(t('shop.dustpanEmptiedIntoThe'));
          return;
        }
        const bag = disposeCleaningBag();
        if (bag > 0) {
          if (hooks.sfx) hooks.sfx('disposal');
          if (hooks.toast) hooks.toast(t('shop.filledTrashBagDisposed'));
          presentRestorationFeedback(syncGenericCleanupMilestone(state));
        }
      },
    });
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
  // (module-level DELIVERY_CARRY_RENDER_LAYER — kept here as a local alias so
  // the surrounding code reads unchanged)
  const DELIVERY_CARRY_RENDER_LAYER = CARRY_RENDER_LAYER;
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

  // Dynamic carton geometry is rebuilt while tape and flaps move. Mark only the
  // geometry created for that rebuild; product models and kit materials stay shared.
  const ownedGeometry = (geometry) => {
    geometry.userData.inventoryOwned = true;
    return geometry;
  };
  const ownedMesh = (geometry, material) => new THREE.Mesh(ownedGeometry(geometry), material);
  function disposeOwnedRenderable(root) {
    if (!root) return;
    root.traverse((o) => {
      if (o.geometry && o.geometry.userData.inventoryOwned) o.geometry.dispose();
    });
  }
  function clearOwnedGroup(root) {
    for (const child of [...root.children]) disposeOwnedRenderable(child);
    root.clear();
  }

  const boxInsideFilledMat = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 1 });
  const boxInsideEmptyMat = new THREE.MeshStandardMaterial({ color: 0x241a10, roughness: 1 });
  const deliveryShaftGeo = new THREE.CylinderGeometry(0.009, 0.011, 0.40, 8);
  const deliveryUmbrellaGeo = new THREE.ConeGeometry(0.075, 0.18, 10);
  const deliveryRollGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.18, 8);
  const deliveryCarryPalmGeo = new THREE.SphereGeometry(0.048, 12, 8);
  const carryForearmGeo = new THREE.CylinderGeometry(0.045, 0.06, 0.34, 10);
  const carrySkinMat = new THREE.MeshStandardMaterial({ color: 0xc98f68, roughness: 0.82 });
  const carrySleeveMat = new THREE.MeshStandardMaterial({ color: 0x294f34, roughness: 0.9 });

  function makeCarryHands(span, y, z) {
    const hands = new THREE.Group();
    for (const sign of [-1, 1]) {
      const palm = new THREE.Mesh(deliveryCarryPalmGeo, carrySkinMat);
      palm.scale.set(1.05, 0.78, 1.18);
      palm.position.set(sign * span, y, z);
      const thumb = new THREE.Mesh(deliveryCarryPalmGeo, carrySkinMat);
      thumb.scale.set(0.58, 0.48, 0.82);
      thumb.position.set(sign * (span - 0.038), y - 0.006, z - 0.036);
      const sleeve = new THREE.Mesh(carryForearmGeo, carrySleeveMat);
      sleeve.position.set(sign * (span + 0.055), y - 0.18, z + 0.055);
      sleeve.rotation.z = sign * -0.24;
      sleeve.rotation.x = 0.12;
      hands.add(sleeve, palm, thumb);
    }
    return hands;
  }

  // Labels remain exact, but only labels used by the current rebuild survive.
  // That keeps a hundred partial-unpack cycles from retaining a hundred canvases.
  const shipLabelCache = new Map();
  let shipLabelGeneration = 0;
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
    if (entry.sig === sig) {
      entry.used = shipLabelGeneration;
      return entry.mat;
    }
    entry.sig = sig;
    const c = entry.c;
    c.clearRect(0, 0, 256, 160);
    c.fillStyle = '#efe7d4'; c.fillRect(0, 0, 256, 160);
    c.strokeStyle = '#b9a074'; c.lineWidth = 4; c.strokeRect(6, 6, 244, 148);
    c.fillStyle = '#1f3a24'; c.font = 'bold 18px Georgia';
    c.fillText((box.supplier || 'PINEHOLLOW PARCEL').slice(0, 20), 16, 33);
    c.fillStyle = '#2a2a26'; c.font = '15px Georgia';
    c.fillText(`ORDER #${String(box.orderId || 0).padStart(4, '0')}`, 16, 59);
    c.fillText(`${(sku ? sku.name : box.skuId).slice(0, 22)}`, 16, 82);
    c.fillText(`REMAIN ${box.qty}/${box.initialQuantity || box.cap || box.qty}`, 16, 105);
    c.fillText(`${box.lb != null ? `${box.lb} LB` : ''}  ${(box.weightClass || 'light').toUpperCase()}`, 16, 127);
    const categoryMark = { balls: 'O', clubs: 'T', apparel: 'A', accessories: 'G', supplies: 'S', decor: 'D' }[sku ? sku.cat : 'accessories'] || 'G';
    c.fillStyle = '#1f4a26'; c.beginPath(); c.arc(229, 28, 14, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#efe7d4'; c.font = 'bold 17px Georgia'; c.textAlign = 'center';
    c.fillText(categoryMark, 229, 34);
    c.textAlign = 'start';
    if (box.fragile) {
      c.fillStyle = '#a12a1e'; c.font = 'bold 17px Georgia';
      c.fillText('FRAGILE', 158, 143);
    }
    entry.used = shipLabelGeneration;
    entry.tex.needsUpdate = true;
    return entry.mat;
  }
  function pruneShipLabels() {
    for (const [key, entry] of shipLabelCache) {
      if (entry.used === shipLabelGeneration) continue;
      entry.tex.dispose();
      entry.mat.dispose();
      shipLabelCache.delete(key);
    }
  }

  function fitProductUnit(object, maxW, maxH, maxD) {
    const holder = new THREE.Group();
    holder.add(object);
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object);
    const size = bounds.getSize(new THREE.Vector3());
    if (size.x > 0 && size.y > 0 && size.z > 0) {
      const scale = Math.min(maxW / size.x, maxH / size.y, maxD / size.z);
      object.scale.multiplyScalar(scale);
      object.updateMatrixWorld(true);
      const fitted = new THREE.Box3().setFromObject(object);
      const centre = fitted.getCenter(new THREE.Vector3());
      object.position.x -= centre.x;
      object.position.y -= fitted.min.y;
      object.position.z -= centre.z;
    }
    return holder;
  }

  // The open box and the player's arms use the same recognizable product
  // silhouettes as the retail fixtures; nothing turns into a generic white block.
  function makeDeliveryUnit(sku, maxW, maxH, maxD, index = 0) {
    let object = null;
    const id = sku && sku.id;
    if (sku && sku.cat === 'clubs') {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(deliveryShaftGeo, mats.merchSteel);
      shaft.position.y = 0.20;
      g.add(shaft);
      const headName = id.startsWith('driver') ? 'head_driver'
        : id.startsWith('putter') ? 'head_putter'
          : id.startsWith('wedge') ? 'head_wedge' : 'head_iron';
      const head = merch.instantiate(headName);
      if (head) g.add(head);
      object = g;
    } else if (sku && sku.cat === 'balls') {
      object = new THREE.Mesh(BALL_BOX_GEO, ballBoxMat(sku));
    } else if (id === 'cap1') {
      object = merch.instantiateRaw('cap_pro');
    } else if (id === 'shoe1') {
      object = merch.instantiateRaw('shoe_pro');
    } else if (id === 'range2') {
      object = merch.instantiateRaw('rangefinder');
    } else if (id === 'glove1') {
      object = merch.instantiate('glove');
    } else if (id === 'polo1' || id === 'polo2' || id === 'jacket2') {
      object = merch.instantiate(id === 'jacket2' ? 'jacket_hanging' : 'polo_folded', { tint: POLO_TINTS[id] });
      if (id === 'jacket2' && object) object.rotation.x = Math.PI / 2;
    } else if (id === 'bag1') {
      object = merch.instantiate('bag', { tint: BAG_TINTS[index % BAG_TINTS.length] });
    } else if (id === 'umb1') {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(deliveryShaftGeo, mats.merchDark);
      shaft.position.y = 0.20;
      const canopy = new THREE.Mesh(deliveryUmbrellaGeo, skuMat(sku));
      canopy.position.y = 0.43;
      g.add(shaft, canopy);
      object = g;
    } else if (id === 'towel1' || id === 'sock1') {
      object = new THREE.Mesh(deliveryRollGeo, id === 'sock1' ? mats.merchWhite : skuMat(sku));
      object.rotation.z = Math.PI / 2;
    }
    if (!object) object = new THREE.Mesh(CARTON_GEO, sku ? cartonMat(sku) : mats.merchWhite);
    return fitProductUnit(object, maxW, maxH, maxD);
  }

  // A six-cell visual layer shows full / three-quarter / half / nearly-empty
  // states, while the label and interaction prompt retain the exact unit count.
  function contentsInBox(box, w, h, d) {
    const g = new THREE.Group();
    const sku = SHOP_CATALOG.find((s) => s.id === box.skuId);
    const initial = Math.max(1, box.initialQuantity || box.cap || box.qty);
    const ratio = Math.max(0, Math.min(1, box.qty / initial));
    const show = box.qty <= 6 ? box.qty : Math.max(1, Math.ceil(ratio * 6));
    const cellW = w * 0.22;
    const cellD = d * 0.27;
    for (let i = 0; i < show; i++) {
      const item = makeDeliveryUnit(sku, cellW, h * 0.42, cellD, i);
      item.updateMatrixWorld(true);
      const unitBounds = new THREE.Box3().setFromObject(item);
      const fillTop = h * (0.78 + ratio * 0.18);
      const baseY = Math.max(h * 0.12, fillTop - unitBounds.max.y);
      item.position.set((i % 3 - 1) * w * 0.27, baseY, (Math.floor(i / 3) - 0.5) * d * 0.30);
      item.rotation.y = (i % 2 ? 0.08 : -0.06);
      g.add(item);
    }
    return g;
  }

  // A driver does not arrive in a glove box. Sealed cases have a true top seam;
  // opened cases have four walls, a bottom and correctly hinged outward flaps.
  function makeBoxMesh(box) {
    const g = new THREE.Group();
    g.userData.deliveryDisposeAllGeometries = true;
    const { w, h, d } = boxDims(box.box || 'carton');
    const sku = SHOP_CATALOG.find((s) => s.id === box.skuId);

    if (box.flat) {
      const slab = ownedMesh(new THREE.BoxGeometry(w, 0.03, d * 1.6), cardboardDark);
      slab.position.y = 0.015;
      slab.castShadow = true;
      g.add(slab);
      return g;
    }

    const opened = tapeCut(box);
    if (!opened) {
      const body = ownedMesh(new THREE.BoxGeometry(w, h, d), cardboard);
      body.position.y = h / 2;
      body.castShadow = true;
      g.add(body);
    } else {
      const wall = 0.024;
      const bottom = ownedMesh(new THREE.BoxGeometry(w - wall * 2, 0.035, d - wall * 2), isEmpty(box) ? boxInsideEmptyMat : boxInsideFilledMat);
      bottom.position.y = 0.018;
      g.add(bottom);
      for (const sign of [-1, 1]) {
        const side = ownedMesh(new THREE.BoxGeometry(w, h, wall), cardboard);
        side.position.set(0, h / 2, sign * (d / 2 - wall / 2));
        side.castShadow = true;
        g.add(side);
        const end = ownedMesh(new THREE.BoxGeometry(wall, h, d - wall * 2), cardboard);
        end.position.set(sign * (w / 2 - wall / 2), h / 2, 0);
        end.castShadow = true;
        g.add(end);
      }
    }

    const label = ownedMesh(
      new THREE.PlaneGeometry(Math.min(w * 0.82, 0.52), Math.min(h * 0.74, 0.34)),
      boxLabelMat(box, sku),
    );
    label.position.set(0, h * 0.54, d / 2 + 0.003);
    g.add(label);

    if (!opened) {
      const cut = Math.max(0, Math.min(1, box.tape || 0));
      const remain = 1 - Math.min(1, cut / 0.72);
      if (remain > 0.015) {
        const seam = ownedMesh(new THREE.BoxGeometry(Math.max(0.045, w * 0.10), 0.012, d * remain), tapeMat);
        seam.position.set(0, h + 0.006, -d / 2 + (d * remain) / 2);
        g.add(seam);
      }
      if (cut < 0.88) {
        for (const z of [-d * 0.33, d * 0.33]) {
          const cross = ownedMesh(new THREE.BoxGeometry(w + 0.01, 0.012, Math.max(0.035, d * 0.09)), tapeMat);
          cross.position.set(0, h + 0.006, z);
          g.add(cross);
        }
      }
    } else {
      // FOUR flaps, in the authored panel order [FRONT, BACK, LEFT, RIGHT], read straight
      // off flapProgress. This fallback carton used to have two, driven from the legacy
      // two-value `flaps` mirror — which meant that once FLAP_PHASES paired opposite
      // flaps (FRONT+BACK, then LEFT+RIGHT), the first press opened both panels this
      // carton had and the second press had nothing left to move. A press that does
      // nothing visible is the exact failure the two-phase gesture was built to avoid.
      const fl = Array.isArray(box.flapProgress) && box.flapProgress.length >= 4
        ? box.flapProgress
        : normalizedFourFlaps(box.flaps);
      for (const [i, axis, sign] of [[0, 'z', -1], [1, 'z', 1], [2, 'x', -1], [3, 'x', 1]]) {
        const amount = Math.max(0, Math.min(1, fl[i] || 0));
        const along = axis === 'z' ? d : w;
        const across = axis === 'z' ? w : d;
        const flap = new THREE.Group();
        const panel = ownedMesh(
          axis === 'z'
            ? new THREE.BoxGeometry(across * 0.98, 0.012, along * 0.49)
            : new THREE.BoxGeometry(along * 0.49, 0.012, across * 0.98),
          cardboardDark,
        );
        panel.position[axis] = -sign * along * 0.245;
        flap.add(panel);
        flap.position.set(axis === 'x' ? sign * w * 0.5 : 0, h, axis === 'z' ? sign * d * 0.5 : 0);
        // Hinge about the edge the panel sits on: front/back swing on X, sides on Z, and
        // the side pair's sign is inverted so both fold outward rather than inward.
        if (axis === 'z') flap.rotation.x = -sign * amount * (Math.PI * 0.58);
        else flap.rotation.z = sign * amount * (Math.PI * 0.58);
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
    for (const result of res.restoration || []) presentRestorationFeedback(result);
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
  B.carriedBox = () => carriedBox(state);
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
    const authoredSlots = slotsFor(skuId)
      .map((slot) => resolveAuthoredFixtureSlot(anchor, slot));
    const starterPresentation = starterRetailPresentation(state, skuId, startIndex + count);
    const flightSlots = starterPresentation
      ? starterPresentation.items
        .slice(startIndex, startIndex + count)
        .map((item, offset) => authoredSlots[item.slotIndex]
          ? {
            slot: { ...authoredSlots[item.slotIndex], starterPresentation: item },
            itemIndex: startIndex + offset,
          }
          : null)
        .filter(Boolean)
      : authoredSlots
        .slice(startIndex, startIndex + count)
        .map((slot, offset) => ({ slot, itemIndex: startIndex + offset }));
    if (!flightSlots.length) return false;

    const ghost = new THREE.Group();
    ghost.position.copy(anchor.position);
    ghost.rotation.copy(anchor.rotation);
    ghost.visible = !hiddenFixtureStock.has(fixture.id);
    stockGroup.add(ghost);
    ghost.updateMatrixWorld(true);

    // launch point: where the armful renders, just below the camera's nose
    const hand = new THREE.Vector3(0.1, -0.35, -0.6).applyMatrix4(camera.matrixWorld);
    const handLocal = ghost.worldToLocal(hand.clone());

    flightSlots.forEach(({ slot, itemIndex }, k) => {
      const item = makePresentedStockItem(sku, slot, itemIndex);
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
      // Bounded to the phase THIS press started. Unbounded, one E press ran the
      // whole carton open, which is the behaviour the three-press gesture
      // replaced — the animation would have quietly restored it.
      const target = boxOpeningPhases.get(id);
      const result = openFlap(state, id, dt * 1.55, { stopAfterPhase: target });
      if (!result.ok) {
        boxOpeningAnimations.delete(id);
        boxOpeningPhases.delete(id);
        if (result.phaseComplete) refreshBoxVisual(id);
        continue;
      }
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
    if (box?.loc === 'receiving-fallback') {
      const fallbackBoxes = boxesOf(state).filter((entry) => entry.loc === 'receiving-fallback');
      const fallbackIndex = fallbackBoxes.findIndex((entry) => entry.id === box.id);
      const slot = Number.isSafeInteger(box.receivingSlot) ? box.receivingSlot : fallbackIndex;
      const footprint = ((slot % 6) + 6) % 6;
      const layer = Math.max(0, Math.floor(slot / 6));
      const at = STOCKROOM.receivingInside;
      const lx = at.x + (footprint % 2 - 0.5) * 0.88;
      const lz = at.z + (Math.floor(footprint / 2) - 1) * 1.0;
      const support = layer > 0 ? fallbackBoxes.find((candidate) => (
        candidate.receivingSlot === footprint
      )) : null;
      const stackLift = support ? boxDims(support.box || 'carton').h + 0.025 : 0;
      const wp = L2W(lx, lz);
      const gy = groundYAt(wp.x, wp.z);
      const baseY = (gy !== null && gy !== undefined
        ? gy : heightAt(wp.x, wp.z) + 0.02) + stackLift;
      const ry = boxDims(box.box || 'carton').w > 0.9 ? Math.PI / 2 : 0;
      const worldMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(wp.x, baseY, wp.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      boxGroup.updateWorldMatrix(true, false);
      const local = boxGroup.matrixWorld.clone().invert().multiply(worldMatrix);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      local.decompose(position, quaternion, scale);
      return { position, quaternion, scale, baseY: position.y, palletIndex: null };
    }
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
    const cargoBoxes = allBoxes.filter((box) => (
      (box.loc === 'pad' || box.loc === 'receiving-fallback') && loadIds.has(box.id)
    ));
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
      if (!box || (box.loc !== 'pad' && box.loc !== 'receiving-fallback')) {
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
        let lx; let lz; let ry; let ly = 0;
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
          ry = dim.w > 0.9 ? Math.PI / 2 : 0;
          if (box.loc === 'pad') {
            lx = at.x + (i % 3 - 1) * 1.05;
            lz = at.z + (Math.floor(i / 3) - 1) * 1.20;
          } else if (box.loc === 'receiving-fallback') {
            // Twelve fallback cartons occupy six marked footprints in two
            // accessible tiers, wholly west of the receiving-door clearway.
            const footprint = i % 6;
            const layer = Math.floor(i / 6);
            lx = at.x + (footprint % 2 - 0.5) * 0.88;
            lz = at.z + (Math.floor(footprint / 2) - 1) * 1.0;
            if (layer > 0) {
              const support = d.boxes.find((candidate) => (
                candidate.loc === 'receiving-fallback'
                && candidate.receivingSlot === footprint
              ));
              ly = support ? boxDims(support.box || 'carton').h + 0.025 : 0;
            }
          } else {
            const spacingX = Math.max(0.68, dim.w + 0.14);
            const spacingZ = Math.max(0.58, dim.d + 0.14);
            lx = at.x + (i % 3 - 1) * spacingX;
            lz = at.z + Math.floor(i / 3) * spacingZ;
            ry = 0;
          }
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
          : (gy !== null && gy !== undefined ? gy : heightAt(wp.x, wp.z) + 0.02)) + padLift + ly;
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

        // A box on the floor occupies the floor: register a collider so the player AND
        // the customer nav grid (which bakes from the same list) both treat it as solid.
        // The sig gate means a hold-to-cut (same spot) never re-bakes nav.
        //
        // This used to also require box.loc === 'world' - only boxes the PLAYER had put
        // down - on the reasoning that delivered pad and stock stacks "sit at known-clear
        // spots". They do not: a delivery lands them on the sales floor and customers
        // walked straight into them, because the grid could not see them and the path went
        // through. Resting on the floor is the honest predicate, whoever put it there.
        if (resolvedSurfaceId === FLOOR_BOX_SURFACE_ID) {
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
      return 'Recycling - lowering the flattened carton in...';
    }
    if (box.flat && Math.hypot(
      recyclingWorld.x - walk.x,
      recyclingWorld.z - walk.z,
    ) <= 1.8) {
      return 'Recycling - [E] drop the flattened carton in';
    }
    if (!boxPlacementMode?.isActive()) {
      return `Carrying ${name} ×${box.qty} - [E] choose a placement`;
    }
    const diagnostics = boxPlacementMode.diagnostics();
    if (!diagnostics.visible) {
      return `Carrying ${name} ×${box.qty} - aim down at an approved surface · [R] rotate`;
    }
    if (!diagnostics.legal) {
      return `${diagnostics.reason || 'That placement is blocked.'} · [R] rotate · [Esc] keep carrying`;
    }
    return `Carrying ${name} ×${box.qty} - [E] place · [R] rotate · [Esc] keep carrying`;
  }

  // a box in the stockroom is unpacked in place; anywhere else, [E] lifts it into your arms
  function unpackHere(prop, b) {
    return boxPlacementCapabilities(state, b).canUnpack;
  }

  // Can this carton go into the player's arms at all? Deliberately broader than
  // canRepositionClosedCarton below: open, part-emptied and flattened cartons are all
  // carryable, and pickUpBox is what refuses the cases that genuinely cannot be (arms
  // already full, a carton buried under another on the pallet). The only rules here are the
  // ones a prompt has to know before the press: mid-animation, in transit, or already gone.
  function canCarryCarton(prop, b) {
    if (!b || b.loc === 'carried' || carriedBox(state) || carriedGoods(state)) return false;
    if (b.loc === 'pad' && !exposedPadBoxIds.has(b.id)) return false;
    if (boxOpeningAnimations.has(b.id) || boxFlattenAnimations.has(b.id)
      || deliveryBoxTransfers.has(b.id) || recyclingDrop?.id === b.id) return false;
    return true;
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

  function fallbackBoxCovered(b) {
    return b.loc === 'receiving-fallback'
      && Number.isSafeInteger(b.receivingSlot)
      && b.receivingSlot >= 0
      && b.receivingSlot < 6
      && boxesOf(state).some((candidate) => (
        candidate.loc === 'receiving-fallback'
        && candidate.receivingSlot === b.receivingSlot + 6
      ));
  }

  function fallbackBoxCovered(b) {
    return b.loc === 'receiving-fallback'
      && Number.isSafeInteger(b.receivingSlot)
      && b.receivingSlot >= 0
      && b.receivingSlot < 6
      && boxesOf(state).some((candidate) => (
        candidate.loc === 'receiving-fallback'
        && candidate.receivingSlot === b.receivingSlot + 6
      ));
  }

  // the box's verbs, chosen live from its state. Reused across rebuilds (keyed by id) so a
  // hold-to-cut is never torn down mid-cut.
  function boxPropFor(id) {
    const box = () => boxesOf(state).find((b) => b.id === id);
    const pickUp = (b) => {
      const r = pickUpBox(state, b.id);
      if (!r.ok) { say(r.reason, 'warn'); return; }
      sfx('boxup');
      rebuildBoxes();
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
        if (b.flat) return 'Flattened carton - [E] carry it to the recycling';
        if (isEmpty(b)) return boxFlattenAnimations.has(b.id)
          ? `Folding the empty ${name} carton...`
          : `Empty ${name} box - [E] flatten it`;
        if (!unpackHere(prop, b)) {
          const zone = b.loc === 'pad' ? 'Pad delivery: '
            : b.loc === 'receiving-fallback' ? 'Safe receiving: '
              : b.surface && b.surface.startsWith('reserve-rack:') ? 'Stored carton: ' : '';
          // This branch is now close to unreachable: every surface that accepts
          // a carton also opens one. It stays as the honest fallback for a box
          // whose surface cannot be resolved at all — and deliberately no longer
          // recites a list of approved surfaces, because naming the rule was
          // never the fix. The rule was.
          return `${zone}${name} ×${b.qty}${b.lb ? ` · ${b.lb} lb` : ''} - [E] pick up`;
        }
        // One source of truth for "what does the next press do": nextBoxStep
        // decides, and action() below asks the same question. The prompt
        // describing a step the player cannot actually take is its own recurring
        // bug, and it stops being possible when both read the same function.
        if (boxOpeningAnimations.has(b.id)) {
          return boxOpeningPhases.get(b.id) === 0
            ? `${name} - tearing the tape...`
            : `${name} - opening the carton...`;
        }
        const held = carriedGoods(state);
        const handsFull = !!(held && held.skuId !== b.skuId);
        switch (nextBoxStep(b, { canUnpack: true, handsFull })) {
          case BOX_STEP.TEAR:
            return `${name} case · ${b.qty} inside - [E] tear the tape open`;
          case BOX_STEP.FLAP:
            return `${name} - [E] open the other flap`;
          case BOX_STEP.BLOCKED:
            // NAME THE KEY. This prompt used to say "put down what you're holding first"
            // when no key put anything down — an instruction the player could not follow.
            return `${name} ×${b.qty}, open - [Z] set down what you're holding first`;
          case BOX_STEP.TAKE:
          default:
            return `${name} ×${b.qty} in the case - [E] take an armful`;
        }
      },
      // NO TOOL. A carton used to demand the box cutter be equipped and then
      // dragged along a projected seam at the right speed; `tool`, `toolProgress`
      // and `toolPath` were that contract and they are all gone. Opening a box is
      // three E presses now and nothing else.
      //
      // This is also what retires the cutter as an item: it was never in the tool
      // wheel, and the only way to hold one was for a prop to ask for it here.
      // With nothing asking, it cannot be equipped. See OVERNIGHT_REPORT_2.md.
      // X IS THE CARRY VERB. Reported 2026-07-29: "Add a button to pick a box up."
      //
      // It used to offer only `reposition closed carton`, which required the carton to be
      // sealed AND non-empty — so an opened carton in the wrong place could not be moved at
      // all, and the only way to shift one was to empty it. X now picks up any carton the
      // sim will let you carry and lets pickUpBox be the authority on whether that is
      // allowed, rather than duplicating a narrower rule here. Z is the inverse (see
      // main.js): X into your arms, Z back onto the floor.
      get secondaryLabel() {
        const b = box();
        if (!canCarryCarton(prop, b)) return null;
        if (canRepositionClosedCarton(prop, b)) return 'reposition closed carton';
        return b.flat ? 'pick up the flattened carton' : 'pick the carton up';
      },
      secondaryAction: () => {
        const b = box();
        if (!canCarryCarton(prop, b)) return;
        pickUp(b);
      },
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
        if (!flapsOpen(b)) {
          if (boxOpeningAnimations.has(b.id)) return; // a press mid-animation is not a second step
          const step = beginBoxStep(state, b.id);
          if (!step.ok) { if (step.reason) say(step.reason, 'warn'); return; }
          boxOpeningAnimations.add(b.id);
          boxOpeningPhases.set(b.id, step.phase);
          // Each press gets its own sound, because each press is its own mechanical event:
          // the tape gives once, the second flap does not. Reported 2026-07-29 as "the sound
          // is thin" — the two cues used here were a 0.24 s hiss and a single 0.18 s noise
          // burst. They are now built from different materials (adhesive stick-slip vs board
          // resonance), which is why they cannot read as two volumes of one noise.
          sfx(step.tore ? 'boxTapeTear' : 'boxFlapFold');
          if (step.tore) tutorialFlag(state, 'boxCut');
          refreshBoxVisual(b.id);
          return;
        }
        const r = takeFromBox(state, b.id);
        if (!r.ok) { say(r.reason, 'warn'); return; }
        // The third press: a hand goes in and the stack is disturbed. itemRemoval is the
        // generic "a unit left a fixture" cue and is still right everywhere else; reaching
        // into a carton has goods knocking each other, which that cue does not contain.
        sfx('boxContentsShift');
        tutorialFlag(state, 'boxCarried');
        if (r.left <= 0) say(`${r.taken} × ${name} - the case is empty.`);
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
          return `Holding ${sku.name} ×${cg.qty} - [E] store ${units} in back · sales floor: ${fixture?.title || 'assigned display'}`;
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
          say('Stand beside a green receiving rack to store these units.', 'warn');
        } else {
          say('Carry these to the right fixture and hold [E], or take them to the backroom.', 'warn');
        }
      }
    },
  });

  // The cleaning bay turns the authored bucket and waste kit into one forgiving, readable loop.
  // One E press completes the insert + wring sequence; the player never has to pixel-hunt a
  // lever. The physical animation still shows every part of that action.
  if (!shedPresentation) { // the shed's own mop-bucket station arrives in a later task
    const wp = L2W(7.25, 1.10); // the authored asset-73 placement socket
    addProp({
      x: wp.x, z: wp.z, r: 1.90, aimY: floorY + 0.72, focusBias: 0.22,
      label: () => {
        const held = hooks.getTool?.();
        const status = cleaningStatus(state);
        if (!status) return null;
        if (held === 'mop') {
          const charge = Math.round((status.mop.charge / status.mop.capacity) * 100);
          const water = status.bucket.water === 'empty'
            ? 'empty'
            : `${status.bucket.water} water ${Math.round(status.bucket.level * 100)}%`;
          return `Mop bucket · ${water} · mop ${charge}% - [E] insert and wring`;
        }
        if (held === 'dustpan') {
          return status.pan.load > 0
            ? `Trash bag · pan ${status.pan.load.toFixed(1)}/${status.pan.capacity} - [E] empty pan into bag`
            : 'Dustpan empty · sweep a pile into it first';
        }
        if (held === 'trashbag') {
          if (status.bag.tied) return 'Trash bag tied - carry it to the waste station';
          if (status.bag.load > 0) {
            return `Trash bag ${status.bag.load.toFixed(1)}/${status.bag.capacity} - [E] tie bag`;
          }
          return 'Fresh trash bag - collect loose debris or empty the dustpan here';
        }
        return 'Cleaning bay - equip the mop, dustpan, or trash bag';
      },
      get secondaryLabel() {
        return hooks.getTool?.() === 'mop' ? 'change bucket water' : null;
      },
      secondaryAction: () => {
        if (changeBucketWater(state).ok) {
          syncBucketVisual();
          props61to100.play(73, ['Bucket_WringerOpen', 'WringerOpen', 'LeverUp']);
          sfx('mopStart');
          say('Fresh clean water in the bucket.');
        }
      },
      action: () => {
        const held = hooks.getTool?.();
        if (held === 'mop') {
          const result = serviceMop(state);
          if (!result.ok) {
            say('The bucket is empty - press [X] here to change the water.', 'warn');
            return;
          }
          syncBucketVisual();
          props61to100.play(73, ['Bucket_WringerClose', 'WringerClose', 'LeverDown']);
          hooks.toolAction?.('mop', 'service');
          sfx('mopStart');
          say(`Mop wrung and ready · bucket water ${result.water}.`);
          return;
        }
        if (held === 'dustpan') {
          const result = emptyPanIntoBag(state);
          if (result.moved > 0) {
            hooks.toolAction?.('dustpan', 'empty');
            sfx('disposal');
            say(result.left > 0
              ? `Bag full · ${result.left.toFixed(1)} remains in the pan.`
              : 'Dustpan emptied into the trash bag.');
          }
          return;
        }
        if (held === 'trashbag') {
          const result = tieBag(state);
          if (result.ok) {
            hooks.toolAction?.('trashbag', 'tie');
            sfx('paper');
            say(`Bag tied · ${result.load.toFixed(1)} collected. Take it to the waste station.`);
          } else if (result.reason === 'bag-empty') {
            say('The bag is empty.', 'warn');
          }
        }
      },
    });
  }

  // the recycling / waste bin by the stock door
  {
    const wp = L2W(STOCKROOM.bin.x, STOCKROOM.bin.z);
    addProp({
      x: wp.x, z: wp.z, r: 1.8,
      label: () => {
        const held = hooks.getTool?.();
        const cleaning = cleaningStatus(state);
        if (held === 'trashbag' && cleaning) {
          if (cleaning.bag.tied) return 'Waste station - [E] dispose tied trash bag';
          if (cleaning.bag.load > 0) return 'Waste station - tie the loaded bag at the cleaning bay first';
          return 'Waste station - the trash bag is empty';
        }
        const cb = carriedBox(state);
        if (recyclingDrop) return 'Recycling - lowering the flattened carton in...';
        if (cb && cb.flat) return 'Recycling - [E] drop the flattened carton in';
        const dd = state.shop.deliveries;
        const flatNear = dd && dd.boxes.some((b) => b.flat && b.loc !== 'carried');
        return flatNear || (dd && dd.trash > 0) ? 'Recycling - [E] break down the flattened cartons' : null;
      },
      action: () => {
        if (hooks.getTool?.() === 'trashbag') {
          const result = disposeTiedBag(state);
          if (result.ok) {
            hooks.toolAction?.('trashbag', 'dispose');
            sfx('disposal');
            say(`Tied bag disposed · ${result.disposed.toFixed(1)} removed. A fresh bag is ready.`);
          } else if (result.reason === 'not-tied') {
            say('Tie the loaded bag at the cleaning bay first.', 'warn');
          }
          return;
        }
        const cb = carriedBox(state);
        if (cb && cb.flat) {
          startRecyclingDrop(cb);
          return;
        }
        if (emptyTrash(state).ok) { sfx('disposal'); say('Cardboard recycled - the stockroom breathes again.'); rebuildBoxes(); }
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
          if (status?.active) return 'Delivery hand truck - checking the axle balance...';
          const box = carriedBox(state);
          if (box) {
            const placement = handTruckPlacementForCarriedBox(state, box.id);
            return placement.ok
              ? 'Delivery hand truck - [E] place the carton on the toe plate'
              : `Delivery hand truck - ${placement.reason}`;
          }
          return 'Delivery hand truck - [E] tip it back and check the load balance';
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
              ? 'Stocking cart - [E] place the carton on the top deck'
              : `Stocking cart - ${placement.reason}`;
          }
          const occupied = boxesOf(state).filter((boxEntry) => (
            boxEntry.loc === 'equipment'
            && boxEntry.equipmentId === 'delivery_stocking_cart'
          )).length;
          return occupied
            ? `Stocking cart - ${occupied} saved carton position${occupied === 1 ? '' : 's'} in use`
            : 'Stocking cart - top deck ready for a delivery carton';
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
        if (status?.active) return 'Pallet jack - hydraulic stroke in progress...';
        return status?.raised
          ? 'Pallet jack - [E] pump once to lower the forks'
          : 'Pallet jack - [E] pump once to raise the forks';
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
      (box.loc === 'pad' || box.loc === 'receiving-fallback')
      && sameDeliveryOrder(box, orderId)
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
  const customers = [];
  let customerLifecycleSequence = 0;
  let customerRouteSequence = 0;
  // buildDoors is constructed before the customer simulation and receives a
  // lazy view. Publish the live array as soon as it exists; otherwise automatic
  // doorway checks keep seeing an empty list while real shoppers are on screen.
  customerView = { actors: customers };
  let disposing = false;
  let disposalSummary = null;
  // golfer-wardrobe palette, muted to the club color language
  const CUST_COLORS = [0x4a6d94, 0x2c3e66, 0xb0788f, 0x8f4f39, 0x4a7050, 0x7b8277, 0x4d4038];
  // C6 — how often somebody here for a tee time also shops. Before this the
  // answer was structurally 0%: the browse-stop builder lived inside the
  // "no other reason to be here" branch. 0.45 is the rate a real pro shop
  // recognises — most people at the desk glance at the wall on the way past —
  // and it is a named constant so the measured share can be moved deliberately.
  // QA can pin this so a driver observes the case it means to observe rather
  // than waiting on a coin flip; the live game always uses the default.
  let COMBINED_VISIT_CHANCE = 0.45;
  // The C6 acceptance instrument. Counting live customers cannot answer "N of M
  // visits", because a visit ends by being removed from the array — so the tally
  // is incremented at the four moments and read afterwards.
  const visitTally = {
    arrivals: 0,          // everyone who walked in
    deskErrands: 0,       // here for a tee time (pre-registered OR walk-in ask)
    retailOnly: 0,        // here to shop and nothing else
    combinedOffered: 0,   // desk errand that also drew a shopping plan
    combinedStarted: 0,   // ...and reached the shop floor after the desk
    combinedCompleted: 0, // ...and paid for something
    checkInsCompleted: 0,
    purchasesCompleted: 0,
  };
  const counterQueue = [];

  // --- NAV-WAIT-001: a browse stand serves ONE customer at a time -----------
  // The defect this closes: a customer whose chosen stand was occupied had no
  // wait state. It kept the stand point as its goal and kept walking at it, so
  // bodies stacked in the approach band shoving and sidestepping until the
  // stand freed — 90 of 95 (neglected) and 79 of 82 (restored) of ALL measured
  // churn episodes were this one class, at p50 ~18-20 s.
  //
  // Escalating them was always the wrong verb: they were never STUCK, their
  // goal simply was not available yet. So the stand now carries a claim, and a
  // customer that cannot have it waits — spaced, facing the stand, out of the
  // approach band — instead of pressing into it.
  const WAIT_RING = Object.freeze({
    slotsPerRow: 4,
    // Across the stand's face. Wider than a body (0.68) at every slot so the
    // waiting itself cannot become the new shoving.
    spanX: 2.10,
    // Behind the browse pose (which sits at halfDepth + 0.72). 1.85 puts the
    // first row clear of the 2.60-yd approach band the defect was measured in.
    standOff: 1.85,
    rowStep: 0.80,
    // Past this many, waiting is hopeless and the shopper moves on rather than
    // forming an unbounded crowd.
    maxSlots: 8,
  });
  // Matches the defect's own attribution band (an episode counted as this class
  // only if the walker stalled within 2.60 yd of the stand it was heading for),
  // so the fix operates exactly where the problem was measured.
  const STAND_CLAIM_RADIUS = 2.60;
  const fixtureClaims = new Map(); // fixtureId -> the customer browsing it
  // placedFixtures() rebuilds a list; the wait poses need lookups by id every
  // frame, so cache one map per update and invalidate it when the floor changes.
  let fixtureByIdCache = null;
  function fixtureById() {
    if (!fixtureByIdCache) {
      fixtureByIdCache = new Map(placedFixtures(state).map((f) => [f.id, f]));
    }
    return fixtureByIdCache;
  }

  function releaseFixtureClaim(c) {
    if (!c || !c.fixtureClaim) return false;
    if (fixtureClaims.get(c.fixtureClaim) === c) fixtureClaims.delete(c.fixtureClaim);
    c.fixtureClaim = null;
    c.waitSlot = null;
    c.waitFixtureId = null;
    return true;
  }

  // A spaced hold point behind the stand, in the fixture's own frame, so it
  // rotates with the display exactly as the browse pose does.
  function fixtureWaitPose(fixture, slot) {
    const row = Math.floor(slot / WAIT_RING.slotsPerRow);
    const column = slot % WAIT_RING.slotsPerRow;
    const spread = WAIT_RING.slotsPerRow > 1
      ? (column - (WAIT_RING.slotsPerRow - 1) / 2) * (WAIT_RING.spanX / (WAIT_RING.slotsPerRow - 1))
      : 0;
    const halfDepth = Number.isFinite(fixture.footprint?.maxZ)
      ? fixture.footprint.maxZ
      : (FIXTURE_HALF[fixture.kind] || [1, 1])[1];
    const local = fixtureBrowsePoint(
      fixture,
      spread,
      halfDepth + WAIT_RING.standOff + row * WAIT_RING.rowStep,
    );
    const target = L2W(local.x, local.z);
    const origin = L2W(fixture.x, fixture.z);
    return { x: target.x, z: target.z, faceX: origin.x, faceZ: origin.z };
  }

  // Stable while a customer keeps waiting on the same stand, so waiters do not
  // swap places every frame — that would be its own kind of churn.
  function waitSlotFor(c, fixtureId) {
    if (c.waitFixtureId === fixtureId && Number.isFinite(c.waitSlot)) return c.waitSlot;
    const taken = new Set();
    for (const other of customers) {
      if (other !== c && other.waitFixtureId === fixtureId && Number.isFinite(other.waitSlot)) {
        taken.add(other.waitSlot);
      }
    }
    let slot = 0;
    while (taken.has(slot) && slot < WAIT_RING.maxSlots) slot += 1;
    if (slot >= WAIT_RING.maxSlots) return null; // the crowd is full; move on
    c.waitFixtureId = fixtureId;
    c.waitSlot = slot;
    return slot;
  }

  const doorW = L2W(DOOR_MAIN.x, halfD);
  const spawnW = { x: doorW.x + 1.5, z: doorW.z + SHELL.porchD + 9 };

  // --- THE OPEN / CLOSED SIGN -----------------------------------------------
  // A physical card hung beside the main door, flipped with E. It gives the day
  // a shape: arrive, unlock, clean, stock, check the sheet — THEN open, and only
  // then does the pressure start. The rule it enforces lives in
  // src/sim/shopSign.js; this is the object you walk up to.
  //
  // It hangs INSIDE, on the jamb, because the player reads and flips it from the
  // shop floor. Its two faces are painted the way a real one is: the side facing
  // the street says one thing while the side facing you says the other, so a
  // single card carries both states and flipping it is a 180° turn, not a
  // material swap.
  const shopSign = (() => {
    const SIGN_W = 0.30;
    const SIGN_H = 0.20;
    const face = (top, bottom, ink, ground) => {
      const canvas = document.createElement('canvas');
      canvas.width = 384;
      canvas.height = 256;
      const c2 = canvas.getContext('2d');
      c2.fillStyle = ground;
      c2.fillRect(0, 0, 384, 256);
      c2.strokeStyle = ink;
      c2.lineWidth = 10;
      c2.strokeRect(16, 16, 352, 224);
      c2.fillStyle = ink;
      c2.textAlign = 'center';
      c2.textBaseline = 'middle';
      c2.font = '700 86px Georgia, serif';
      c2.fillText(top, 192, 108);
      c2.font = '600 30px Arial, sans-serif';
      c2.fillText(bottom, 192, 178);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      return texture;
    };
    // deadpan, per the tone ruling in Designs/ROADMAP.md
    const openTexture = face('OPEN', 'COME IN', '#173f2d', '#f4efe2');
    const closedTexture = face('CLOSED', 'BACK SOON', '#6b2f28', '#f4efe2');
    const group = new THREE.Group();
    group.name = 'ClubhouseOpenClosedSign';
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(SIGN_W, SIGN_H, 0.012),
      [
        mats.walnutDark, mats.walnutDark, mats.walnutDark, mats.walnutDark,
        new THREE.MeshStandardMaterial({ map: openTexture, roughness: 0.85 }),
        new THREE.MeshStandardMaterial({ map: closedTexture, roughness: 0.85 }),
      ],
    );
    group.add(board);
    // Beside the door on the interior face of the south wall, at eye height.
    //
    // ONE DATUM, TWO FRAMES. The card is a child of `interior`, so it takes the
    // LOCAL point; the walk prop is matched against world walk.x/z, so it takes
    // the same point through L2W. This used to hand the world point to both,
    // which applied the building offset twice and left the card 360 yards away
    // from the hotspot that flips it (measured 2026-08-03).
    // INTERIOR.d, not the SHELL wall centreline. `halfD` is the centreline of a
    // 0.25 yd wall, so hanging 0.10 in from it left the card 0.025 yd BEHIND
    // the inner face — inside the wall, which is also what isInside() said.
    // INTERIOR.d/2 is the face the player stands against and the same envelope
    // the room's own inside test uses.
    const signLocal = shopSignLocalPoint(DOOR_MAIN, INTERIOR.d);
    const hang = L2W(signLocal.x, signLocal.z);
    group.position.set(signLocal.x, signLocal.y, signLocal.z);
    interior.add(group);
    suppressInteriorSunShadows(group);

    // K (Goal 23) — THE SIGN WAS FLOATING, AND IT HAD TO BE.
    //
    // The stranger's word was "floating" and the geometry agrees exactly: an
    // 0.012 yd board centred 0.10 yd off the wall leaves its back face 8.6 cm
    // proud of the plaster with nothing whatever between them.
    //
    // And it cannot simply be pushed flush, because this card SPINS THROUGH 180
    // DEGREES to flip between OPEN and CLOSED -- that turn is the whole gesture
    // and a card against the wall cannot make it. A thing that must stand off a
    // wall needs something holding it there, so: a bracket arm out of the wall
    // and a collar at the pivot.
    //
    // The mount is a sibling of the card, NOT a child of it. The card turns; the
    // bracket must not turn with it, or the fixture swings out of the wall every
    // time the shop opens.
    const mount = new THREE.Group();
    mount.name = 'ClubhouseOpenClosedSignMount';
    const wallZ = INTERIOR.d / 2;                    // the plaster face
    const armLen = Math.max(0.02, wallZ - signLocal.z); // wall face to the card
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, 0.022, armLen),
      mats.brass,
    );
    // spans the gap: half its length back from the card toward the wall
    arm.position.set(0, 0.075, armLen / 2);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.008), mats.brass);
    plate.position.set(0, 0.075, armLen - 0.004);
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.055, 10),
      mats.brass,
    );
    collar.position.set(0, 0.05, 0);
    mount.add(arm, plate, collar);
    mount.position.set(signLocal.x, signLocal.y, signLocal.z);
    interior.add(mount);
    suppressInteriorSunShadows(mount);

    // CLOSED shows the customer-facing side to the player; OPEN turns the card
    // around. The yaw IS the state, so there is nothing to keep in sync.
    //
    // THE TURN IS VISIBLE. It used to assign the target yaw outright, so the
    // card teleported through 180 degrees between two frames and the only
    // evidence anything happened was the toast. You flipped it and it had
    // always been that way. Now the target is stored and the card SWINGS to it
    // over SPIN_S, eased in and out, so the flip is a thing you watched happen.
    // A quarter-second is about right: long enough to read as a turn, short
    // enough that opening the shop is not a cutscene.
    const SPIN_S = 0.28;
    const spin = { from: 0, to: 0, t: 1 };
    const applyFacing = (animate = false) => {
      const want = signIsOpen(state) ? Math.PI : 0;
      if (!animate) {
        spin.from = want; spin.to = want; spin.t = 1;
        group.rotation.y = want;
        return;
      }
      if (Math.abs(want - spin.to) < 1e-6) return;
      spin.from = group.rotation.y;
      spin.to = want;
      spin.t = 0;
    };
    // Ticked from the clubhouse update; a no-op once the card has settled.
    const tickSpin = (dt) => {
      if (spin.t >= 1) return;
      spin.t = Math.min(1, spin.t + dt / SPIN_S);
      // smoothstep: the card starts moving, swings, and settles rather than
      // arriving at full speed and stopping dead against nothing
      const e = spin.t * spin.t * (3 - 2 * spin.t);
      group.rotation.y = spin.from + (spin.to - spin.from) * e;
    };
    applyFacing();
    // The card used to be re-aimed only at build and on the E press, so the
    // midnight rollover (closeSignForNewDay) flipped the SIM to CLOSED and left
    // the card facing OPEN until someone pressed E twice. Registered AFTER the
    // silent applyFacing() above, so a save that loads OPEN starts turned
    // rather than swinging round on the first frame.
    openClosedSigns.register(group.name, () => applyFacing(true));

    const prop = addProp({
      x: hang.x,
      z: hang.z,
      r: 1.9,
      label: () => (signIsOpen(state)
        ? 'Door sign: OPEN - [E] close up'
        : 'Door sign: CLOSED - [E] open for business'),
      action: () => {
        const result = flipSign(state, ((state.clock.minutes % 1440) + 1440) % 1440);
        if (!result.ok) return;
        applyFacing(true); // swing it, do not teleport it
        // E2: the sign is cardboard on a string, not a menu row
        if (hooks.sfx) hooks.sfx('signFlip');
        // State the fact; no coaching, and no warning about opening late or
        // opening filthy — the player learns those (Designs/ROADMAP.md).
        if (hooks.toast) {
          hooks.toast(result.open
            ? (result.withinHours ? 'Sign turned to OPEN.' : 'Sign turned to OPEN. Nobody is out there yet.')
            : 'Sign turned to CLOSED.');
        }
      },
    });
    return { group, prop, applyFacing, tickSpin };
  })();

  // --- reusable customer baskets --------------------------------------------------
  // Eight authored baskets are instantiated once and reparented between this rack,
  // customers, and the checkout. Four are shown in the stack; the rest are a pool,
  // not new per-customer drawables or free-physics containers.
  const basketPool = [];
  const basketPlasticMat = mats.merchPlastic.clone();
  basketPlasticMat.color.setHex(0x4f8a62);
  const basketStation = new THREE.Group();
  basketStation.name = 'customerBasketStation';
  basketStation.position.set(BASKET_STATION.x, 0, BASKET_STATION.z);
  interior.add(basketStation);
  const basketBase = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.07, 0.48), mats.walnutDark);
  basketBase.position.y = 0.035;
  basketBase.castShadow = true;
  basketStation.add(basketBase);
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.58, 0.42), mats.brass);
    rail.position.set(sx * 0.31, 0.30, 0);
    basketStation.add(rail);
  }
  addCol(colBoxAt(BASKET_STATION.x, BASKET_STATION.z, BASKET_STATION.w, BASKET_STATION.d));

  const carryGeo = {
    box: new THREE.BoxGeometry(0.15, 0.08, 0.11),
    slim: new THREE.BoxGeometry(0.12, 0.045, 0.08),
  };
  const carryMats = new Map();
  const carryMat = (sku) => {
    const key = sku?.cat || 'other';
    if (!carryMats.has(key)) carryMats.set(key, new THREE.MeshStandardMaterial({
      color: CAT_COLORS[key] || 0x8b927f, roughness: 0.74,
    }));
    return carryMats.get(key);
  };
  const carryModel = { polo1: 'polo_folded', polo2: 'polo_folded', jacket2: 'polo_folded', cap1: 'cap', glove1: 'glove', bag1: 'bag' };

  function customerProductVisual(sku, compact = false) {
    const group = new THREE.Group();
    const modelName = sku && carryModel[sku.id];
    let model = modelName && merch?.has(modelName) ? merch.instantiate(modelName, { tint: CAT_COLORS[sku.cat] }) : null;
    if (model) {
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const target = compact ? 0.15 : (sku.id === 'bag1' ? 0.52 : 0.24);
      model.scale.setScalar(target / Math.max(size.x, size.y, size.z, 0.001));
      model.position.y = compact ? 0.03 : 0;
      group.add(model);
      return group;
    }
    if (sku?.cat === 'clubs') {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, compact ? 0.18 : 0.92, 8), mats.merchSteel);
      const head = new THREE.Mesh(new THREE.BoxGeometry(compact ? 0.06 : 0.13, compact ? 0.035 : 0.07, compact ? 0.035 : 0.08), mats.charcoal);
      head.position.set(compact ? 0.02 : 0.05, compact ? -0.08 : -0.44, 0);
      group.add(shaft, head);
      return group;
    }
    const box = new THREE.Mesh(compact ? carryGeo.slim : carryGeo.box, carryMat(sku));
    box.castShadow = true;
    group.add(box);
    return group;
  }

  function refreshBasketStation() {
    const available = basketPool.filter((entry) => !entry.owner);
    available.forEach((entry, i) => {
      interior.add(entry.root);
      entry.root.visible = i < 4;
      // Rest the bottom basket ON the walnut base plate (0.07 tall) instead
      // of hovering 3 cm above it — the §11 float audit's one real finding.
      entry.root.position.set(BASKET_STATION.x, 0.072 + i * 0.085, BASKET_STATION.z);
      entry.root.rotation.set(0, -0.12 + i * 0.035, 0);
      entry.root.scale.setScalar(1);
    });
  }

  function syncBasketContents(c) {
    if (!c.basket) return;
    c.basket.contents.clear();
    const sockets = [
      [-0.10, 0.13, -0.045], [0.08, 0.14, 0.035], [0.00, 0.19, -0.01],
    ];
    visibleBasketSlots(c.cart).forEach((unit, i) => {
      const sku = SHOP_CATALOG.find((item) => item.id === unit.skuId);
      const visual = customerProductVisual(sku, true);
      visual.position.fromArray(sockets[i]);
      visual.rotation.y = (i - 1) * 0.45;
      c.basket.contents.add(visual);
    });
  }

  function takeBasket(c) {
    if (c.basket) return true;
    const entry = basketPool.find((candidate) => !candidate.owner);
    if (!entry) return false;
    entry.owner = c;
    entry.root.visible = true;
    c.mesh.add(entry.root);
    entry.root.position.set(0.40, 0.60, -0.06);
    entry.root.rotation.set(0, -0.10, -0.06);
    entry.root.scale.setScalar(0.92);
    c.basket = entry;
    c.hasBasket = true;
    refreshBasketStation();
    return true;
  }

  function stageBasket(c) {
    for (const unit of c.cart) stageUnit(unit);
    if (c.itemMesh) {
      c.mesh.remove(c.itemMesh);
      c.itemMesh = null;
    }
    if (!c.basket) return;
    c.basket.contents.clear();
    interior.add(c.basket.root);
    c.basket.root.visible = true;
    c.basket.root.position.set(1.76, COUNTER_TOP + 0.025, 3.82);
    c.basket.root.rotation.set(0, 0.08, 0);
    c.basket.root.scale.setScalar(0.86);
    c.basketAtCheckout = true;
  }

  function returnBasket(c) {
    if (!c?.basket) return;
    c.basket.contents.clear();
    c.basket.owner = null;
    c.basket = null;
    c.hasBasket = false;
    c.basketAtCheckout = false;
    refreshBasketStation();
  }

  if (merch) merch.onReady(() => {
    for (let i = 0; i < 8; i++) {
      const root = merch.instantiate('basket');
      if (!root) break;
      root.traverse((part) => {
        if (part.isMesh && part.userData.slot === 'M_plastic') part.material = basketPlasticMat;
      });
      root.name = `pooledCustomerBasket${i + 1}`;
      const contents = new THREE.Group();
      contents.name = 'authoredItemSockets';
      root.add(contents);
      basketPool.push({ root, contents, owner: null });
    }
    refreshBasketStation();
  });

  function queueSlotW(i) {
    const s = queueSlot(i);
    return L2W(s.x, s.z);
  }

  // C3 (Goal 24) — NOTHING IS HANDED OVER UNTIL THEY ARE AT THE DESK.
  //
  // "They hand goods THROUGH the body of the person being served, before their
  // turn." The gate on placing goods was `counterQueue.indexOf(c) === 0`, which
  // is a position in an ARRAY, not a position on the floor. Goal 23's own note
  // on queue advancement says why that is not the same thing: "THE LINE ADVANCES
  // WHEN THE FLOOR IS CLEAR, NOT WHEN THE ARRAY IS" — the moment the served
  // customer is spliced out, the next person is index 0 while still standing
  // several yards back, with the person ahead of them physically in the way.
  //
  // They then began reaching for the staging mat from there, and the product's
  // flight is a straight line from their wrist to the counter, so it passes
  // through whoever is still standing at the desk. Nothing was wrong with the
  // motion; the person playing it was in the wrong place.
  //
  // So the body has to have arrived. QUEUE_HEAD_REACH_YD is a stride and a bit:
  // tight enough that there is nobody between them and the counter, loose enough
  // that the last few inches of settling do not stall the sale.
  // Read from the layout table, which owns the queue geometry this is measured
  // against. It was a local 0.8 while the pitch between slots is 0.684, so slot
  // 1 counted as the desk — see the note beside `headReachYd`.
  const QUEUE_HEAD_REACH_YD = PINE_HILLS_V2_LAYOUT?.queue?.headReachYd ?? 0.45;
  // Half a set of shoulders, plus a little. A product whose path comes closer
  // than this to somebody's centre line has gone through them.
  const BODY_CLEARANCE_YD = 0.32;
  function customerIsAtTheDesk(c) {
    if (!c || !c.mesh) return false;
    const slot = queueSlotW(0);
    if (Math.hypot(c.mesh.position.x - slot.x, c.mesh.position.z - slot.z)
      > QUEUE_HEAD_REACH_YD) return false;
    return deskApproachIsClear(c);
  }

  // ...AND NOBODY IS STANDING IN THE WAY OF THE HAND.
  //
  // Standing at the head slot is not sufficient, which the measurement found
  // and I would not have guessed. When the line advances, the customer who has
  // just been served is STILL WALKING AWAY and is briefly between the new head
  // and the counter — so the next person, correctly at the desk by every other
  // test, reaches straight through the back of someone who has not left yet.
  // The corridor from the placing hand to the staging mat has to be empty.
  function deskApproachIsClear(c) {
    const target = L2W(REGISTER.staging.x, REGISTER.staging.z);
    const ax = c.mesh.position.x;
    const az = c.mesh.position.z;
    const vx = target.x - ax;
    const vz = target.z - az;
    const len2 = (vx * vx) + (vz * vz);
    if (len2 < 1e-4) return true;
    for (const other of customers) {
      if (other === c || !other.mesh) continue;
      const t = (((other.mesh.position.x - ax) * vx) + ((other.mesh.position.z - az) * vz)) / len2;
      // behind the hand, or past the counter: not in the way
      if (t <= 0.15 || t >= 1) continue;
      const cx = ax + (vx * t);
      const cz = az + (vz * t);
      if (Math.hypot(other.mesh.position.x - cx, other.mesh.position.z - cz)
        < BODY_CLEARANCE_YD) return false;
    }
    return true;
  }

  function experienceStop(fixture, claimed) {
    if (!fixture?.experience) return null;
    const socket = fixtureSockets(fixture).find((candidate) => !claimed.has(candidate.key));
    if (!socket) return null;
    const target = fixture.experienceTarget
      ? fixtureSockets({ ...fixture, browse: [fixture.experienceTarget] })[0]
      : { x: fixture.x, z: fixture.z };
    const world = L2W(socket.x, socket.z);
    const face = L2W(target.x, target.z);
    return {
      kind: 'experience',
      experience: fixture.experience,
      title: fixture.title,
      fixtureId: fixture.id,
      socketKey: socket.key,
      x: world.x,
      z: world.z,
      faceX: face.x,
      faceZ: face.z,
      duration: fixture.experience === 'putting' ? 5.2 : fixture.experience === 'fitting' ? 4.2 : 3.2,
    };
  }

  // C6 — THE RETAIL ERRAND, lifted out of spawnCustomer (2026-08-04).
  //
  // This block used to live inside `if (!toCounter && !walkInRequest)`, which is
  // why the combined-visit share was not low but structurally zero: a customer
  // here for a tee time never received a shopping plan, so they could never buy
  // anything, and no probability anywhere changed that.
  //
  // It is a pure builder now — it produces the plan and the stops and adds
  // nothing to the customer — so the same errand can be built at spawn and
  // spliced in later, after the desk has finished with a golfer.
  function buildRetailErrand(rng) {
    const stops = [];
    const floorFixtures = placedFixtures(state);
    const browsable = floorFixtures.filter((f) => f.skus && f.skus.length > 0);
    const claimed = new Set(customers.flatMap((customer) => customer.stops
      .slice(customer.stopIdx)
      .map((stop) => stop.socketKey)
      .filter(Boolean)));
    // Plan one real fixture visit per intended unit, preferring different
    // displays before revisiting a well-stocked one.
    const organicPlan = planOrganicOrder(browsable, state.shop.inventory, rng);
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
      for (const id of f.experienceAfter || []) {
        const beat = experienceStop(floorFixtures.find((candidate) => candidate.id === id), claimed);
        if (!beat || stops.some((s) => s.fixtureId === id)) continue;
        claimed.add(beat.socketKey);
        stops.push(beat);
        break;
      }
    }
    return { organicPlan, stops };
  }

  // THE SECOND HALF OF A COMBINED VISIT (2026-08-06 order ruling).
  //
  // The shopping is walked first now, so what is held back is the DESK
  // business: the golfer pays for their goods, then asks about their tee time
  // at the same counter without queueing twice. Called from the paid-sale
  // site; returns false when there is nothing pending, which leaves a
  // shop-only customer's behaviour exactly as it was.
  // B2 (Goal 23) — THE ASK, RAISED WHILE THE TICKET IS STILL OPEN.
  //
  // WHAT THE OLD CHECK MEASURED: tests/one-visit-one-payment.test.js drives
  // createTx -> scanItem -> attachGreenFeeToTx -> payOnce ->
  // finalizeReservationCheckIn directly on the sim modules. Eleven tests, all
  // honest, all green, and not one of them asks whether a customer in the shop
  // ever reaches that path. They never did: the only thing that raised the tee
  // time errand was beginPendingDesk, called from the paid-sale site, and
  // attachGreenFeeToTx requires tx.stage 'scanning' on an unbanked ticket. The
  // merged ticket was provably correct and structurally unreachable.
  //
  // This is the ask itself, and nothing else. It deliberately does NOT
  // reclassify the customer as desk business, because doing that while they
  // still hold unpaid goods is the unpaid-exit escape recorded at
  // openWalkInCustomer: booked or rejected, both desk outcomes released them to
  // the door and the goods silently restocked as a lost sale. They stay the
  // counter customer with an open ticket; what changes is that the player now
  // HEARS the request in time to put it on the same ticket.
  function raiseDeskErrandAtCounter(c) {
    if (!c || !c.deskErrandPending || c.deskErrandSpoken) return false;
    if (c.reservationId == null && !c.requestedTeeMinute) return false;
    c.deskErrandSpoken = true;
    c.deskErrandRaisedMidSale = true;
    c.patience = PATIENCE_FULL;
    setPatience(c);
    c.dialogue = combinedVisitDeskLine(c);
    if (hooks.toast) hooks.toast(t('shop.customerSays', { name: c.name, line: c.dialogue }), 'info');
    visitTally.combinedStarted += 1;
    return true;
  }

  // B2 (Goal 24) — THE ASK NAMES A TIME, because there is nothing to offer
  // otherwise.
  //
  // "One more thing, have you got a time free today?" is a question the player
  // cannot answer: the desk books a SLOT, and the customer never said which. The
  // shape already existed for a plain walk-in twenty lines further down
  // (`could I get the 10:40 tee time?`) and the combined visit simply did not
  // use it — even though `requestedTeeMinute` is the very field that lets this
  // errand be raised at all, so the time was always known and never spoken.
  //
  // Same flow, same wording shape, same desk buttons: the player offers,
  // adjusts, or refuses the named time.
  function combinedVisitDeskLine(c) {
    if (c.reservationId != null) return 'While I am here, can I check in for my tee time?';
    const party = c.partySize || 1;
    if (!Number.isFinite(c.requestedTeeMinute)) {
      // no minute to name: keep it honest rather than inventing one
      return `One more thing: anything open today for ${party}?`;
    }
    return party > 1
      ? `One more thing: could we get ${fmtSlot(c.requestedTeeMinute)} for ${party}?`
      : `One more thing: could I get the ${fmtSlot(c.requestedTeeMinute)} tee time?`;
  }

  function beginPendingDesk(c) {
    if (!c || !c.deskErrandPending) return false;
    if (c.reservationId == null && !c.requestedTeeMinute) return false;
    // Already settled on the ticket they just paid: the merged path ran, the
    // round is checked in, and sending them back to the desk for it would ask
    // the player to serve the same errand twice.
    if (c.reservationId != null) {
      const booking = reservationById(state, c.reservationId);
      if (booking && booking.status !== 'booked') {
        c.deskErrandPending = false;
        return false;
      }
    }
    c.deskErrandPending = false;
    // they stay where they are - already at the head of the counter - and
    // become desk business, which is what puts them on the check-in list
    c.checkoutPhase = c.reservationId != null ? 'reservation-waiting' : 'walk-in-waiting';
    c.currentDestination = 'front-desk';
    c.awaitingCheckout = false;
    c.patience = PATIENCE_FULL;
    setPatience(c);
    // B1 (Goal 23) — NOBODY WHO HAS ASKED FOR SOMETHING LEAVES BEFORE IT IS
    // ANSWERED.
    //
    // Setting checkoutPhase was not enough to keep them here, and this is why
    // "they announce a tee time and then walk out" survived: the desk branch is
    // guarded by `stop.kind === 'counter'`, and the shopping route's counter
    // stop has already been CONSUMED by the purchase that just completed. On
    // the next frame the route reads 'exit' and the person leaves mid-sentence,
    // with their own line still on screen.
    //
    // So the route is pinned back to the counter, which is where they are
    // standing and where the answer has to come from.
    const counterStop = Array.isArray(c.stops)
      ? c.stops.findIndex((s) => s && s.kind === 'counter') : -1;
    if (counterStop >= 0) c.stopIdx = counterStop;
    c.linger = 0;
    c.deskErrandAwaitingAnswer = true;
    if (!c.deskErrandSpoken) {
      c.deskErrandSpoken = true;
      // asked AFTER the goods, and the wording follows whether they hold a
      // booking or are hoping for one. B2 (Goal 24): one authority for the
      // wording, so the two sites cannot drift into asking differently.
      c.dialogue = combinedVisitDeskLine(c);
      if (hooks.toast) hooks.toast(t('shop.customerSays', { name: c.name, line: c.dialogue }), 'info');
    }
    visitTally.combinedStarted += 1;
    return true;
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
    // M1 (2026-08-05): the personality clause is gone. It gated walk-in tee
    // requests to friendly/exacting — a third of identities — on top of the
    // 58% purpose gate, so desk errands ran ~19% of organic arrivals and a
    // combined (book+buy) visit was a once-an-hour event nobody ever saw
    // complete. Wanting a tee time is a PURPOSE, not a personality trait; a
    // hurried golfer asks for one faster, not never. Purpose stays the gate.
    const walkInRequest = !toCounter
      && (options.forceWalkIn === true
        || (options.allowWalkInRequest === true
          && identity.visitProfile.preferredPurpose === 'tee-time'));
    const customerType = reservationId != null
      ? (reservation.customerType || 'reservation')
      : walkInRequest ? 'walk-in-tee' : 'retail';
    const rng = rngOf(state);
    // L1 (2026-08-05): a walk-in golfer arrives ASKING FOR A TIME — the ask
    // is the errand. Until now no ask existed at the live desk: the check-in
    // tab could only deal generic next openings, so "book them in at the
    // time they asked" was impossible by construction. The ask is a minute
    // off the sheet's own grid, at least the walk-in lead out, biased toward
    // the next couple of hours the way a same-day caller actually asks — and
    // deliberately blind to availability: people ask for the time they want,
    // and the desk reconciles it against the sheet (resolveTeeTimeRequest,
    // walk report B6's scheduler).
    let walkInAskMinute = null;
    if (walkInRequest) {
      if (Number.isFinite(options.requestedTeeMinute)) {
        walkInAskMinute = Math.floor(options.requestedTeeMinute);
      } else {
        // D2 (Goal 20), found by Verifier 1: this used to reach up to the TENTH
        // slot ahead, which on a thirty-minute grid is five hours — the same
        // fault the arrival planner had, in a second place, so fixing the
        // planner alone left half the walk-ins asking for the afternoon. One
        // rule now, in customerSimulation.walkInAskFrom.
        // 4.2 (Goal 26): the ask is now checked against REAL AVAILABILITY, so
        // "if everything inside the next hour is already booked, there is no
        // walk-in request at all" is true in the game and not only in the sim
        // helper. Without this argument the rule would be correct and unreachable
        // -- the zero-call-sites shape this repository keeps paying for.
        const dayAbs = Math.floor(state.clock.minutes / 1440);
        let bookedMinutes;
        try {
          const free = new Set(availableSlots(state, dayAbs, { walkIn: true })
            .map((slot) => slot.minute));
          bookedMinutes = slotTimes(state).filter((minute) => !free.has(minute));
        } catch { bookedMinutes = null; }
        walkInAskMinute = walkInAskFrom(
          state.clock.minutes % 1440, slotTimes(state), rng.next(),
          bookedMinutes ? { bookedMinutes } : {},
        );
      }
    }
    const visitorId = `visitor-${state.shop.nextVisitorId++}`;
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
    // Customers already receive grounded contact through GTAO. Keeping every
    // articulated limb in the course-scale directional shadow atlas turns a
    // ten-person shop floor into hundreds of moving shadow casters and violates
    // the clubhouse's restricted interior caster policy.
    suppressInteriorSunShadows(g);
    g.position.set(spawnW.x + (rng.next() - 0.5) * 3, heightAt(spawnW.x, spawnW.z), spawnW.z + rng.next() * 2);
    custGroup.add(g);

    const plansBasket = !toCounter && rng.chance(0.62);
    const plannedCount = plansBasket ? 2 + rng.int(2) : 1;
    const stops = [];
    let organicPlan = { target: 0, picks: [] };
    // the approach: porch step, then just inside the door (the doorbell moment)
    stops.push({ kind: 'walk', x: doorW.x, z: doorW.z + 2.6 });
    stops.push({ kind: 'enter', x: doorW.x, z: doorW.z - 1.4 });
    // C6: a shopping plan is no longer welded to "arrived with no other
    // reason" - a tee-time arrival gets one too, on a roll. Since the
    // 2026-08-06 order ruling they WALK it first and hold the desk business
    // back (`deskErrandPending`) until the goods are paid for.
    const combinedIntent = (toCounter || walkInRequest)
      && options.skipRetailPlan !== true
      && rng.chance(COMBINED_VISIT_CHANCE)
      && placedFixtures(state).some((f) => f.skus && f.skus.length > 0);
    const retailPlan = (!toCounter && !walkInRequest) || combinedIntent
      ? buildRetailErrand(rng)
      : null;
    visitTally.arrivals += 1;
    if (toCounter || walkInRequest) visitTally.deskErrands += 1; else visitTally.retailOnly += 1;
    if (combinedIntent) visitTally.combinedOffered += 1;
    // 2026-08-06 ruling: "they first buy things from the shop and then on top
    // of that after you scan everything they say can i also check in for my
    // time". So a combined visit SHOPS FIRST and raises the desk errand at the
    // counter once the goods are scanned. Previously the desk came first and
    // the shopping was spliced in afterwards, which read backwards: the golfer
    // checked in, wandered off, and queued a second time.
    if (retailPlan) {
      organicPlan = retailPlan.organicPlan;
      stops.push(...retailPlan.stops);
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
      && state.clock.minutes < deskReadyAt
      && shopTierIndex(state) >= 2;
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
      // F5 (Full_Goal_16): the paying customer addresses the CASHIER'S
      // stand, not the register-block datum out by the bag — face across the
      // counter at the person serving them.
      const regW = L2W(COUNTER.staffStand.x, COUNTER.staffStand.z);
      stops.push({ kind: 'counter', x: queueSlotW(0).x, z: queueSlotW(0).z, faceX: regW.x, faceZ: regW.z });
    }
    stops.push({ kind: 'exit', x: doorW.x, z: doorW.z + 2.6 });
    stops.push({ kind: 'gone', x: spawnW.x, z: spawnW.z });

    const customer = {
      mesh: g,
      identity,
      customerId: identity.customerId,
      visitorId,
      spawnSource: options.spawnSource || 'scripted-or-reservation',
      lifecycleBoundaryId: options.lifecycleBoundary?.lifecycleId ?? null,
      lifecycleBoundaryAtMs: Number.isFinite(options.lifecycleBoundary?.atMs)
        ? options.lifecycleBoundary.atMs : null,
      // Constant-size QA/profiling evidence. This is the production creation
      // edge used to order the first organic route request without polling-time
      // inference; it does not participate in customer behavior.
      createdAtMs: performance.now(),
      routeDiagnostics: null,
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
      requestedTeeMinute: walkInAskMinute,
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
      // C6 + the 2026-08-06 order ruling: the errand is now walked FIRST, so
      // nothing is held pending. What IS held is the desk business, raised at
      // the counter after the goods are scanned.
      deskErrandPending: combinedIntent,
      deskErrandSpoken: false,
      combinedVisit: combinedIntent,
      scanned: 0,
      patience: PATIENCE_FULL,   // the 3-minute register clock; browsing never drains it
      awaitingCheckout: false,
      itemMeshes: new Map(),
      checkoutProductResources: createRegisterItemResources(),
      oversizeCarryRoot: null,
      // a combined visitor is a SHOPPER until the goods are paid for; only
      // then do they become desk business
      checkoutPhase: organicPlan.target
        ? 'shopping'
        : (reservationId != null
          ? (loungeEarly ? 'reservation-arriving' : 'reservation-arriving')
          : walkInRequest ? 'walk-in-arriving' : 'browsing'),
      currentDestination: loungeEarly
        ? 'lounge'
        : ((toCounter || walkInRequest) && !combinedIntent ? 'front-desk' : 'shop'),
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
      checkoutHandoffProducts: [],
      checkoutHandoffOversizeProducts: [],
      checkoutHandoffProductDisposer: null,
      handoffReceipt: null,
      bagAcceptanceHold: 0,
      bagAcceptanceFace: null,
      bagAcceptanceYaw: null,
      impatientBeat: null,
      giveUpHandled: false,
      reachedRegHead: false,   // the 3-minute register clock arms here, never while browsing
      visitRecorded: false,
    };
    customers.push(customer);
    return customer;
  }

  function clearExperience(c) {
    if (c.experienceMesh) {
      if (c.experienceMesh.parent) c.experienceMesh.parent.remove(c.experienceMesh);
      releaseVisual(c.experienceMesh);
      c.experienceMesh = null;
    }
    c.experienceStarted = false;
  }

  function beginExperience(c, stop) {
    if (c.experienceStarted) return;
    c.experienceStarted = true;
    c.linger = Math.max(c.linger, stop.duration || 3.2);
    if (stop.experience === 'fitting') {
      c.patience = Math.min(PATIENCE_FULL, c.patience + 4);
      return;
    }
    if (stop.experience !== 'putting') return;
    const beat = new THREE.Group();
    beat.name = 'customer-putting-beat';
    const putter = makeStockItem(
      SHOP_CATALOG.find((s) => s.id === 'putter2'),
      { x: 0, y: 0, z: 0, len: 0.88, lean: 0.08, ry: 0 },
      0,
    );
    if (putter) {
      putter.position.set(-0.20, 0.36, 0.12);
      putter.rotation.y = -0.3;
      beat.add(putter);
    }
    c.mesh.add(beat);
    c.experienceMesh = beat;
  }

  function updateExperience(c, stop) {
    beginExperience(c, stop);
    if (stop.experience === 'putting' && c.experienceMesh) {
      const elapsed = Math.max(0, (stop.duration || 5.2) - c.linger);
      c.experienceMesh.rotation.z = Math.sin(Math.min(1, elapsed / 1.6) * Math.PI) * 0.18;
    }
  }

  function makeCustomerCarryModel(sku, index) {
    const item = makeStockItem(
      sku,
      { x: 0, y: 0, z: 0, ry: 0, len: 0.82, lean: 0.08, folded: false, wall: false },
      index,
    );
    if (!item) return null;
    item.name = `carried-${sku.id}`;
    return item;
  }

  function rebuildCustomerCarry(c) {
    if (c.itemMesh) {
      c.mesh.remove(c.itemMesh);
      releaseVisual(c.itemMesh);
    }
    c.itemMesh = null;
    if (!c.cart.length) return;
    const g = new THREE.Group();
    g.name = 'customer-merchandise';
    const small = c.cart.filter((it) => {
      const sku = SHOP_CATALOG.find((s) => s.id === it.skuId);
      return sku && sku.cat !== 'clubs' && !it.skuId.startsWith('bag');
    });
    if (small.length) {
      const basket = merch.instantiate('basket', { scale: 0.72 });
      if (basket) {
        basket.position.set(0.12, 0.58, 0.18);
        basket.rotation.y = Math.PI / 2;
        g.add(basket);
      }
    }
    c.cart.forEach((it, index) => {
      const sku = SHOP_CATALOG.find((s) => s.id === it.skuId);
      if (!sku) return;
      const item = makeCustomerCarryModel(sku, index);
      if (!item) return;
      if (sku.cat === 'clubs') {
        item.position.set(-0.24 - index * 0.05, 0.42, 0.12);
        item.rotation.y = -0.35;
      } else if (it.skuId.startsWith('bag')) {
        item.scale.multiplyScalar(0.62);
        item.position.set(0.10, 0.18, 0.12);
        item.rotation.y = Math.PI / 2;
      } else {
        item.scale.multiplyScalar(0.72);
        item.position.set(0.10 + index * 0.08, 0.72 + index * 0.03, 0.17);
        item.rotation.y = -0.25 + index * 0.18;
      }
      g.add(item);
    });
    c.mesh.add(g);
    c.itemMesh = g;
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

  const _placeScaleScratch = new THREE.Vector3();
  function clearCustomerItemMeshes(c) {
    const failures = [];
    if (c.itemMeshes) {
      for (const mesh of c.itemMeshes.values()) {
        try {
          disposeCustomerProductMesh(c, mesh);
        } catch (error) {
          failures.push(error);
          try { mesh?.removeFromParent?.(); } catch { /* keep releasing siblings */ }
        }
      }
      c.itemMeshes.clear();
    }
    c.checkoutPlacement = null;
    c.placeMotion = null;
    if (register && typeof register.setPlacementPreview === 'function') {
      try { register.setPlacementPreview(null); } catch (error) { failures.push(error); }
    }
    return { ok: failures.length === 0, failures };
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
        // C3 (Goal 19): the carried mesh inherited the customer BODY scale
        // (char roots run 0.87-0.99) and attach() preserves it — so goods
        // landed on the counter at the customer's size and popped ~9% bigger
        // when the register rebuilt them at authored scale on the last
        // placement (measured live: world 0.9186 -> 1.0, popRatio 1.089).
        // One size from the moment it leaves the hand: world-true authored.
        const worldScale = mesh.getWorldScale(_placeScaleScratch);
        if (worldScale.x > 1e-6) mesh.scale.multiplyScalar(1 / worldScale.x);
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

  // WHY DOES A SHOPPER LEAVE A STOCKED SHELF EMPTY-HANDED?
  //
  // Ten retail shoppers produced zero carts in a shop measured to hold 110 units
  // across four browsable fixtures, and planOrganicOrder returned 2 picks on
  // 12/12 live trials -- so the plan is sound and the EXECUTION is not. This
  // function has five ways to decline and from outside they are indistinguishable;
  // the counter names which one fired. Diagnostic only, never read by the game.
  const pickStats = {
    calls: 0, noSkus: 0, cartFull: 0, nothingStocked: 0, browseOnlyRoll: 0,
    browseOnlyReplace: 0, shelfRefused: 0, took: 0,
    // and the approach half: did they ever get the stand at all?
    claimed: 0, standGivenUp: 0, noFixtureRecord: 0, fixtureStopSeen: 0,
  };
  function customerPick(c, stop) {
    pickStats.calls += 1;
    if (!stop.skus) { pickStats.noSkus += 1; return; }
    if (c.targetCartSize && c.cart.length >= c.targetCartSize) { pickStats.cartFull += 1; return; }
    const rng = rngOf(state);
    const stocked = stop.skus.filter((id) => {
      if (!state.shop.inventory[id] || state.shop.inventory[id].shelf <= 0) return false;
      const sku = SHOP_CATALOG.find((item) => item.id === id);
      return !c.hasBasket || basketCompatible(sku);
    });
    if (!stocked.length) {
      pickStats.nothingStocked += 1;
      // bare display: they glance and move on — and someone occasionally says so
      c.emptyStops = (c.emptyStops || 0) + 1;
      if (rng.chance(0.18) && hooks.toast && walk.active && isInside(walk.x, walk.z)) {
        hooks.toast(`${c.name} looked over the empty ${stop.title || 'display'} and moved on.`, 'warn');
      }
      return;
    }
    if (stop.browseOnly && !rng.chance(0.55)) { pickStats.browseOnlyRoll += 1; return; }
    // Browse-only visitors may inspect and replace a unit: a visible shelf-count
    // beat with no sale. Planned buyers take exactly one unit at each stop.
    if (stop.browseOnly) {
      pickStats.browseOnlyReplace += 1;
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
    // The checkout UID must survive a reload because the inventory operation
    // journal does. Let the persisted held-unit allocator mint it; a local
    // renderer counter would restart and replay an old lot movement.
    const picked = pickFromShelf(state, skuId);
    if (!picked.ok) { pickStats.shelfRefused += 1; return; }
    pickStats.took += 1;
    const uid = picked.uid;
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
      const regW = L2W(COUNTER.staffStand.x, COUNTER.staffStand.z); // F5: face the cashier
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
      hooks.toast(t('shop.putBackCarried', { name: c.name }), 'warn');
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
        reviewId: reviewIdOfCustomer(c),
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
      hooks.toast(t('shop.tiredOfWaiting', { name: c.name }), 'warn');
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
    // NAV-WAIT-001: never let a departing shopper take a stand's claim with it,
    // or that display is closed for the rest of the day.
    releaseFixtureClaim(c);

    // They came in, they saw the place, they left. That is a visit, and a visit is reviewable —
    // not just the ones that ended in a sale or a tantrum at the till, which is how most of them
    // used to leave without anyone hearing a word about it. About two in five bother to write.
    if (!c.reviewed && c.entered) {
      c.reviewed = true;
      const seed = Math.round((c.seed || 0) * 1000 + (state.dayAbs || 0));
      if (Math.abs(Math.sin(seed * 7.13)) < 0.42) {
        postReview(state, reviewFor(state, {
          reviewId: reviewIdOfCustomer(c),
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
      for (const it of c.cart) {
        abandonUnit(it);
        returnToShelf(state, it.skuId, it.uid);
      }
      c.cart = [];
      if (!disposing) rebuildStock();
    }
    returnBasket(c);
    if (c.tx) c.tx = null;
    c.awaitingCheckout = false;
    c.checkoutPhase = 'leaving';
    leaveQueue(c);
    // The paid carrier owns per-sale GPU resources that are intentionally not
    // part of the character's original resource snapshot. Release it before
    // any optional product/receipt presentation cleanup can fail.
    disposePaidBagFromCustomer(c);
    clearCustomerItemMeshes(c);
    for (const product of c.checkoutHandoffProducts || []) {
      try { product.removeFromParent(); } catch { /* continue releasing sibling resources */ }
      try {
        if (typeof c.checkoutHandoffProductDisposer === 'function') {
          c.checkoutHandoffProductDisposer(product);
        }
      } catch { /* paid-bag and character cleanup must still run */ }
    }
    c.checkoutHandoffProducts = [];
    c.checkoutHandoffProductDisposer = null;
    if (c.oversizeCarryRoot) {
      try {
        if (c.checkoutProductResources) c.checkoutProductResources.dispose(c.oversizeCarryRoot);
      } catch { /* keep removing the paid customer */ }
      try { c.oversizeCarryRoot.removeFromParent(); } catch { /* keep removing */ }
      c.oversizeCarryRoot = null;
    }
    try { disposeCustomerHandoffReceipt(c); } catch { c.handoffReceipt = null; }

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
    const character = c.mesh.userData.char;
    if (character && character.dispose) character.dispose();
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
    // GOODS FIRST, THEN THE DESK — TRIED, AND REVERTED WITH EVIDENCE (Goal 23).
    //
    // openWalkInCustomer has carried a "still holding goods is a shopper"
    // exclusion since F8; this predicate never got one, so I added the mirror:
    //   if (c.cart?.length && !c.bought) return false;
    //
    // It fires the F8 invariant. Watched on both builds with the same driver:
    // WITHOUT it the customer sits at 'reservation-waiting' and the sale runs;
    // WITH it they flip to 'reservation-leaving' and the console prints
    // "[F8-INVARIANT] combined visitor reached the exit with 2 unpaid item(s)
    // after a desk outcome" — the exact escape the exclusion exists to prevent,
    // caused by adding the exclusion. Something downstream releases a booking
    // holder who is neither desk business nor due, and that release is the real
    // bug; the exclusion only exposes it.
    //
    // Left out rather than shipped, because a wrong fix that fires a live
    // invariant is worse than the asymmetry it was meant to correct. The three
    // changes that DO reach one payment (the ask at scan-complete, the payment
    // hold, and the desk list) do not need it.
    const reservation = reservationRecordForCustomer(c);
    return !!reservation && reservation.status === 'booked';
  }

  function openWalkInCustomer(c) {
    return !!c
      && c.customerType === 'walk-in-tee'
      && c.reservationId == null
      && !c.reservationReleased
      && !c.walkInRejected
      // F8 (Full_Goal_16): a combined visitor still HOLDING GOODS is a
      // shopper — the cart branch takes them first (pay, then the desk ask
      // through beginPendingDesk). Classifying them as desk business here
      // was the unpaid-exit escape: booked or rejected, both desk outcomes
      // released them to the door and the goods silently restocked as a
      // lost sale. (__f8LegacyClassifier is the QA-only reintroduction the
      // escape driver's negative control flips on — the ledgerTurnLegacy
      // pattern; never set by the game.)
      // F8 exclusion, with the one exception it was never meant to cover:
      // a customer who has ALREADY PAID and has since asked for a tee time.
      // The escape this guards against is an UNPAID exit — a desk outcome
      // releasing someone who still owes for the goods in their hands. Once
      // `bought` is true there is nothing left to escape with, and holding the
      // exclusion past that point is what made them walk out mid-sentence (B1).
      && (typeof window !== 'undefined' && window.__f8LegacyClassifier
        ? true
        : (!(c.cart && c.cart.length) || (c.bought && c.deskErrandAwaitingAnswer)));
  }

  function openDeskCustomer(c) {
    return openReservationCustomer(c) || openWalkInCustomer(c);
  }

  // B1/B4 (Goal 24) — THE ASK HAD TO BE ANSWERABLE, AND WAS NOT.
  //
  // openWalkInCustomer deliberately excludes anyone still holding goods; that
  // exclusion is the unpaid-exit guard and it stays. But the desk bridge used it
  // for two different jobs — "is this person desk business" (routing) and "may
  // the player act on their request" (the screen) — and the second job needs the
  // opposite answer. A combined visitor asks for a tee time on the last barcode,
  // and from that moment:
  //
  //   * walkIns() filtered them out, so no row appeared on Check In
  //   * with no row there was no slot to book and no button to refuse
  //   * so `deskErrandPending` could never be cleared
  //   * and the automatic payment advance is gated on !deskErrandOutstanding()
  //
  // The result is the owner's B1 exactly: everything bagged, the sale will not
  // complete, no card offered, and no action anywhere that unsticks it. The
  // customer asked a question the game gave the player no way to answer.
  //
  // This predicate is the SCREEN's answer, never the router's. It admits the one
  // extra case — a customer mid-sale who has spoken — and nothing else, so
  // nobody is reclassified as desk business while they still owe for goods.
  function deskActionableWalkIn(c) {
    if (!c) return false;
    if (openWalkInCustomer(c)) return true;
    return c.customerType === 'walk-in-tee'
      && c.reservationId == null
      && !c.reservationReleased
      && !c.walkInRejected
      && !!c.deskErrandRaisedMidSale
      && !!c.deskErrandPending;
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
    c.deskErrandAwaitingAnswer = false; // B1: the errand has been answered
    c.reservationExitReason = reason;
    // C6: checked in, and they came in for a sleeve of balls as well. The desk
    // is finished with them — `reservationReleased` already removes them from
    // deskReservationList — so send them shopping instead of out of the door.
    // Only on a successful check-in: someone turned away is leaving.
    if (reason === 'checked-in' || reason === 'completed') {
      visitTally.checkInsCompleted += 1;
      leaveQueue(c);
    }
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
  // L3 — THE LEDGER BOOK. A bound club register on the front desk: a prop
  // with an E prompt, opened in place by main.js (enterLedger, the laptop
  // focus pattern). It is a LENS on the identity directory's visit history
  // (src/sim/clubRoster.js) — it owns no state and grants nothing.
  const ledgerBook = createLedgerBook({
    THREE,
    state,
    anchor: FRONT_DESK.ledger,
    counterTop: COUNTER_TOP,
    // the journal rises to the FACE on E (the reader's comes-to-you pattern)
    // and voices its cover/riffle/turns through the shared paper cue
    camera,
    sfx,
    // moving the book persists its spot; the E/X prop follows it below
    onPlaced: (spot) => {
      if (state.shop) state.shop.ledgerSpot = { ...spot };
      const world = L2W(spot.x, spot.z);
      ledgerProp.x = world.x;
      ledgerProp.z = world.z;
      ledgerProp.aimY = interior.position.y + spot.y + 0.03;
    },
  });
  suppressInteriorSunShadows(ledgerBook.root);
  interior.add(ledgerBook.root);
  const ledgerProp = (() => {
    const start = ledgerBook.position();
    const world = L2W(start.x, start.z);
    return addProp({
      x: world.x,
      z: world.z,
      // reachable from the till across the counter (the staff stand is
      // 1.77 yd from the spawn spot; the laptop's own prop reaches 2.3)
      r: 2.2,
      // The book can lie INSIDE the tee desk's own E zone (r 2.2 at the
      // register point), which otherwise swallows every press at the counter.
      // Scoring the book as a true 3D aim target (the stacked-carton pattern)
      // makes LOOKING AT THE BOOK act on the book, while a level glance
      // across the desk still serves the desk. aimY is WORLD height - the
      // score compares against the world camera, and this site does not sit
      // at y=0.
      aimY: interior.position.y + start.y + 0.03,
      focusBias: 0.55,
      station: true, // F1: the reading desk is a work station too
      label: () => {
        if (ledgerBook.isOpen() || ledgerBook.isCarried()) return null;
        // D2: this callback fires only when the player is inside the book's
        // reach and roughly facing it, which is the last quiet moment before
        // they press E. Build the pages here so the swing has nothing to do.
        ledgerBook.prewarm?.();
        // D1: say WHAT it is. "Club register" is what the object is called; the
        // player is looking for the book that tells them how the club is doing.
        return 'The club ledger - [E] read the book · [X] carry it';
      },
      action: () => { if (hooks.openLedger) hooks.openLedger(); },
      secondaryAction: () => {
        if (ledgerBook.isOpen() || ledgerBook.isCarried()) return;
        if (carriedBox(state) || carriedGoods(state)) {
          if (hooks.toast) hooks.toast(t('shop.yourArmsAreAlready'), 'warn');
          return;
        }
        ledgerBook.setCarried(true);
        if (hooks.toast) hooks.toast(t('shop.carryingTheClubRegister'));
      },
    });
  })();

  B.frontDeskReservations = {
    // due by the book, plus whoever is PHYSICALLY here for a booking — a guest who walks
    // in ten minutes early must show on the desk while they stand at it
    list: () => deskReservationList(
      state,
      customers
        .filter((c) => c.reservationId != null && !c.reservationReleased
          && (String(c.checkoutPhase || '').startsWith('reservation')
            // B2 (Goal 23) — THE LAST LINK IN THE ONE-PAYMENT CHAIN.
            //
            // A combined visitor mid-sale has checkoutPhase 'placing', not
            // 'reservation-*', so their booking was absent from the desk list
            // at exactly the moment they asked for it. The merged-ticket code
            // was correct, the ask now arrives in time, and the player still
            // could not find the row to click. Someone standing at the counter
            // who has just asked to check in is the definition of "physically
            // here for a booking", which is what this list is for.
            || c.deskErrandRaisedMidSale))
        .map((c) => c.reservationId),
    ),
    // B2 (Goal 19): the desk list must not outlive the person. A customer who
    // gave up and walked ("leaving") LEAVES THE LIST, and every row carries
    // `atSlot` — is this body physically standing on its queue slot right now
    // — so the screen can stop printing IN QUEUE for someone still crossing
    // the room (queued flips true when the counter becomes their STOP, which
    // is decided from across the floor).
    walkIns: () => customers
      .filter((customer) => deskActionableWalkIn(customer)
        && customer.checkoutPhase !== 'leaving')
      .map((customer) => {
        const queueIndex = customer.queued ? counterQueue.indexOf(customer) : -1;
        let atSlot = false;
        if (queueIndex >= 0 && customer.mesh) {
          const slot = queueSlotW(queueIndex);
          atSlot = Math.hypot(
            customer.mesh.position.x - slot.x,
            customer.mesh.position.z - slot.z,
          ) < 0.55;
        }
        return {
          customerId: customer.customerId,
          name: customer.fullName,
          fullName: customer.fullName,
          partySize: customer.partySize || 1,
          paymentPreference: customer.paymentPreference,
          phase: customer.checkoutPhase,
          queued: customer.queued,
          queueIndex,
          atSlot,
          // L1: the ask crosses the bridge — the desk cannot honour a time it
          // never hears
          requestedTeeMinute: Number.isFinite(customer.requestedTeeMinute)
            ? customer.requestedTeeMinute
            : null,
        };
      }),
    customerFor: (id) => customers.find((c) => sameReservationId(c.reservationId, id)) || null,
    readyCustomerFor: (id) => {
      const customer = customers.find((c) => sameReservationId(c.reservationId, id));
      // A booking holder who asks to check in on an open goods ticket remains
      // the checkout customer (`waiting`) until the one combined payment
      // completes. This is screen readiness only; routing and unpaid-exit
      // ownership stay with checkout.
      const combinedAtCounter = !!(customer
        && customer.deskErrandRaisedMidSale
        && customer.deskErrandPending
        && customer.cart?.length);
      return customer
        && customer.queued
        && counterQueue.indexOf(customer) === 0
        && !customer.reservationReleased
        && (customer.checkoutPhase === 'reservation-waiting' || combinedAtCounter)
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
      if (!customer || !deskActionableWalkIn(customer)) return [];
      const dayAbs = Math.floor(state.clock.minutes / 1440);
      const slots = walkInAvailability(state, {
        dayAbs,
        partySize: customer.partySize || 1,
      });
      const asked = Number.isFinite(customer.requestedTeeMinute)
        ? customer.requestedTeeMinute
        : null;
      if (asked == null) return slots;
      // L1: the desk ANSWERS THE ASK — nearest-to-asked first (the resolver's
      // own metric, ties to the earlier slot), with the exact match flagged so
      // the UI can say "their asked time" instead of dealing three arbitrary
      // openings
      return [...slots]
        .sort((a, b) => (
          Math.abs(a.minute - asked) - Math.abs(b.minute - asked) || a.minute - b.minute
        ))
        .map((slot) => ({
          ...slot,
          askedExact: slot.minute === asked,
          deltaFromAskMin: slot.minute - asked,
        }));
    },
    walkInAskFor: (customerId) => {
      const customer = customers.find((candidate) => candidate.customerId === customerId);
      if (!customer || !deskActionableWalkIn(customer)) return null;
      const asked = Number.isFinite(customer.requestedTeeMinute)
        ? customer.requestedTeeMinute
        : null;
      if (asked == null) return null;
      const dayAbs = Math.floor(state.clock.minutes / 1440);
      return {
        asked,
        verdict: resolveTeeTimeRequest(state, dayAbs, asked, {
          partySize: customer.partySize || 1,
        }),
      };
    },
    bookWalkIn: (customerId, dayAbs, minute) => {
      const customer = customers.find((candidate) => candidate.customerId === customerId);
      if (!customer || !deskActionableWalkIn(customer)) {
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
      // B1 (Goal 24): a combined visitor booking mid-sale stays the COUNTER
      // customer. Reclassifying them as desk business here is the F8 unpaid-exit
      // escape by another door -- they still have goods on the counter, and the
      // fee is about to join that same ticket in beginReservationPayment.
      if (!(customer.deskErrandRaisedMidSale && customer.cart && customer.cart.length)) {
        customer.checkoutPhase = 'reservation-waiting';
        customer.currentDestination = 'front-desk';
      }
      // A combined visit is not answered merely because the tee-sheet row was
      // created. The green fee still has to join the open goods ticket. Leave
      // both errand flags armed until beginReservationPayment confirms that
      // attachGreenFeeToTx succeeded; on a rejected/invalid attachment the new
      // booking therefore remains visible and actionable instead of becoming a
      // ghost unpaid reservation with no retry path.
      result.res.currentDestination = 'front-desk';
      result.res.checkInStatus = 'waiting';
      return { ...result, customer };
    },
    rejectWalkIn: (customerId) => {
      const customer = customers.find((candidate) => candidate.customerId === customerId);
      if (!customer || !deskActionableWalkIn(customer)) return false;
      customer.walkInRejected = true;
      customer.deskErrandAwaitingAnswer = false; // B1: turned away IS an answer
      // B4 (Goal 24) — REFUSING THE TEE TIME MUST NOT LOSE THE SALE.
      //
      // Everything below sends the body to the door. For a plain walk-in that is
      // right: they came for a time, there is no time, they leave. For a
      // combined visitor it is a customer with UNPAID GOODS ON THE COUNTER being
      // walked out of the shop by the player answering their question, and the
      // goods restock as a lost sale.
      //
      // Refusal is an ANSWER, so the errand is settled and the payment gate
      // opens. They stay exactly where they are, at the head of the counter,
      // and pay for the goods. Just the goods.
      if (customer.deskErrandRaisedMidSale && customer.cart && customer.cart.length) {
        customer.deskErrandPending = false;
        customer.requestedTeeMinute = null;
        customer.dialogue = 'No luck? Never mind, just these then.';
        if (hooks.toast) {
          hooks.toast(t('shop.customerSays', { name: customer.name, line: customer.dialogue }), 'info');
        }
        return true;
      }
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
    if (!campaignAllowsBusiness(state)) return;
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
    // B3: a rejoin starts from wherever the line actually puts them, not from
    // the slot they were holding last time they stood here.
    c.queueSlotHeld = null;
  }

  // B (Goal 21): the SAME occupancy test resolveCustomer enforces, asked as a
  // question about a point rather than applied as a correction. The two must
  // agree exactly — a look-ahead that avoids something the resolver would have
  // allowed makes the walker jitter on the boundary between the two opinions.
  // The customer is held in a slot rather than closed over, because this runs
  // several times per walker per frame.
  const steerStats = {
    calls: 0, engaged: 0, tooShort: 0, steered: 0, trapped: 0, travelSum: 0, travelMax: 0,
  };

  // 2.1 (Goal 26) — WHILE I AM AT THE TILL, MY BODY IS NOT AN OBSTACLE.
  //
  // "I finish a transaction. The second person walks up, gets blocked by
  // something, sidesteps right to left, then walks in place without moving, then
  // leaves... It happens when I am standing in the middle of the cash register
  // from the opposite side. THAT IS ME."
  //
  // He is right, and it is not one test: the player's body enters the customer
  // simulation in THREE separate places -- the look-ahead's blocked-point query
  // (_customerBlockedAt), the reciprocal-avoidance neighbour list
  // (crowdNeighbours), and the settle pass's hard clamp (crowdClamp). Fixing any
  // one and leaving the others is precisely the two-populations shape that has
  // bitten this repository repeatedly, and it would present as "mostly fixed",
  // which is worse than untouched because it is harder to see.
  //
  // Three, not four: the queue-slot occupancy test (queueSlotIsClear) builds its
  // body list from OTHER CUSTOMERS ONLY and never had the player in it, so there
  // is nothing to clear there. Checked rather than assumed, because "I fixed the
  // occupancy test" would otherwise be a claim about a test that does not
  // consider the thing being cleared.
  //
  // So there is ONE predicate and all four ask it. When the player is parked at a
  // station -- operating the till, reading the ledger, on the laptop or the desk
  // screen -- they are not standing in the room in any sense the crowd should
  // care about: the camera is elsewhere, they cannot move, and they are behind
  // the counter rather than in the customer lane. It restores itself the moment
  // the station lets go, because it is derived every frame rather than latched.
  function playerBlocksCustomers() {
    if (!walk.active) return false;
    // register mode owns the camera for the whole transaction
    try { if (register && register.isActive && register.isActive()) return false; } catch { /* not built yet */ }
    // the book has the player: carried, or open and being read
    try {
      if (ledgerBook && ((ledgerBook.isCarried && ledgerBook.isCarried())
        || (ledgerBook.isOpen && ledgerBook.isOpen()))) return false;
    } catch { /* not built yet */ }
    // the laptop and the desk screen are full-screen surfaces owned by main.js;
    // it publishes them on the app object, which is the only handle this module
    // has to them. Read defensively: an undefined flag must mean "not parked",
    // never "parked", or a missing accessor would phase the player out for good.
    const app = (typeof window !== 'undefined' && window.__fw) ? window.__fw : null;
    if (app && (app.laptopOpen === true || app.deskScreenOpen === true)) return false;
    return true;
  }

  let _steerCustomer = null;
  function _customerBlockedAt(px, pz) {
    const r = 0.3;
    for (const col of custCols) {
      if (col.door) continue; // a doorway is a way through, not a wall
      if (px + r > col.minX && px - r < col.maxX && pz + r > col.minZ && pz - r < col.maxZ) return true;
    }
    if (playerBlocksCustomers() && Math.hypot(px - walk.x, pz - walk.z) < 0.72) return true;
    for (const o of customers) {
      if (o === _steerCustomer || !o.mesh) continue;
      if (Math.hypot(px - o.mesh.position.x, pz - o.mesh.position.z) < 0.6) return true;
    }
    return false;
  }

  // --- CROWD: nobody stands inside anybody ------------------------------------
  //
  // WHO STANDS THEIR GROUND. Someone holding a place in the queue, at the desk,
  // or mid-payment has a reason to be exactly where they are, and letting a
  // passer-by shoulder them out of position is how the line stopped looking like
  // a line. They get infinite mass; the mover goes around.
  // `c.queued` is the real flag -- it is what counterQueue membership is derived
  // from throughout this file. My first version guessed at stage/phase/mode
  // strings that do not exist on these objects, and the diagnostic duly reported
  // `pinned: 0` in a room with a six-deep queue: nobody was standing their
  // ground, which is precisely the bug it was meant to prevent.
  function customerIsPinned(c) {
    if (!c) return false;
    if (c.pinnedForCrowd === true) return true;
    // Holding a place in the line, or standing at the till being served --
    // and actually STANDING. A queuer advancing to the next slot is moving,
    // and calling a mover immovable broke the one guarantee the settle pass
    // makes: pinned-vs-pinned pairs are skipped entirely, so two queuers
    // walking up the line at once could interpenetrate with nothing to part
    // them. The crowd driver caught it as 3/70 overlapping frames, worst
    // 0.19 yd, the first regression of that number since the pass shipped.
    const standing = Math.hypot(c.vx || 0, c.vz || 0) < 0.08;
    if (!standing) return false;
    if (c.queued === true) return true;
    if (c.queueSlotHeld != null) return true;
    return false;
  }

  // Only the people who could matter this frame. Scanning the whole floor per
  // customer is the sort of n-squared that becomes a stall once a room is busy.
  const CROWD_RANGE = 2.4;
  // A person merely WALKING gets the standard body; a person standing their
  // ground in the queue gets a wider one, because the owner's complaint is not
  // "they touched" but "they ran into the LINE" -- a queue deserves a berth, not
  // a graze. The player is wider still: brushing the player reads worse than
  // brushing anyone, and the player cannot be relied on to dodge.
  const QUEUE_BERTH = 0.12;
  const PLAYER_RADIUS = 0.4;
  // POOLED. The first version allocated a fresh record per neighbour per
  // customer per frame -- O(n^2) short-lived objects at 60 Hz, which is GC
  // pressure for no reason and the sort of thing that turns into stutter on a
  // busy floor. The records never outlive the call, so they are reused.
  const _crowdNear = [];
  const _crowdPool = [];
  function crowdRecord(slot) {
    let record = _crowdPool[slot];
    if (!record) {
      record = { x: 0, z: 0, vx: 0, vz: 0, pinned: false, radius: BODY_RADIUS };
      _crowdPool[slot] = record;
    }
    return record;
  }
  function customerNeighbours(c) {
    _crowdNear.length = 0;
    const px = c.mesh.position.x;
    const pz = c.mesh.position.z;
    for (const other of customers) {
      if (other === c || !other.mesh || other.mesh.visible === false) continue;
      const ox = other.mesh.position.x;
      const oz = other.mesh.position.z;
      if (Math.abs(ox - px) > CROWD_RANGE || Math.abs(oz - pz) > CROWD_RANGE) continue;
      const record = crowdRecord(_crowdNear.length);
      record.x = ox;
      record.z = oz;
      record.vx = other.vx || 0;
      record.vz = other.vz || 0;
      record.pinned = customerIsPinned(other);
      record.radius = record.pinned ? BODY_RADIUS + QUEUE_BERTH : BODY_RADIUS;
      _crowdNear.push(record);
    }
    // THE PLAYER IS A NEIGHBOUR TOO. Before this, walkers reasoned about every
    // customer and treated the player as nothing but a hard clamp at the last
    // half-yard -- which is exactly "running into myself in general". The player
    // enters the same reciprocal math as everyone else, with their real
    // velocity, so a walker crossing the player's path swerves EARLY the way it
    // does for another walker. Pinned, because the avoidance must never assume
    // the player will take the other half of the correction.
    // 2.1: ...but not while the player is parked at a station. See
    // playerBlocksCustomers -- this is one of the four places the body enters the
    // simulation and they must agree, or a walker steers around a phantom the
    // resolver would have let it walk straight through.
    if (playerBlocksCustomers()
        && Math.abs(walk.x - px) <= CROWD_RANGE && Math.abs(walk.z - pz) <= CROWD_RANGE) {
      const record = crowdRecord(_crowdNear.length);
      record.x = walk.x;
      record.z = walk.z;
      record.vx = walk.vx || 0;
      record.vz = walk.vz || 0;
      record.pinned = true;
      record.radius = PLAYER_RADIUS;
      _crowdNear.push(record);
    }
    return _crowdNear;
  }

  // THE SIMULTANEOUS PASS, run once after every customer has taken its step. The
  // clamp keeps a body that was pushed out of a neighbour from being pushed into
  // a wall: without it, untangling a clump beside the counter puts somebody
  // inside the counter.
  // Monotonic QA identities for qaCustomerTrack, held OUTSIDE the customer
  // objects so nothing the game owns is mutated by a diagnostic. Never read by
  // the game itself.
  let qaTrackSeq = 0;
  const qaTrackIds = new WeakMap();
  const qaTrackId = (c) => {
    let id = qaTrackIds.get(c);
    if (!id) { qaTrackSeq += 1; id = `q${qaTrackSeq}`; qaTrackIds.set(c, id); }
    return id;
  };
  const crowdStats = { passes: 0, pairsOverlapping: 0, worstOverlap: 0 };
  const _crowdBodies = [];
  const _crowdBodyPool = [];
  function crowdClamp(x, z, radius) {
    let nx = x;
    let nz = z;
    for (const col of custCols) {
      if (nx + radius > col.minX && nx - radius < col.maxX
        && nz + radius > col.minZ && nz - radius < col.maxZ) {
        const pushLeft = nx + radius - col.minX;
        const pushRight = col.maxX - (nx - radius);
        const pushUp = nz + radius - col.minZ;
        const pushDown = col.maxZ - (nz - radius);
        const min = Math.min(pushLeft, pushRight, pushUp, pushDown);
        if (min === pushLeft) nx = col.minX - radius;
        else if (min === pushRight) nx = col.maxX + radius;
        else if (min === pushUp) nz = col.minZ - radius;
        else nz = col.maxZ + radius;
      }
    }
    // 2.1: the hard shove-away. This is the one the owner actually SEES -- it is
    // what pushes a queuer sideways out of the lane and leaves them treading air
    // against a body that, from their point of view, is not there.
    if (playerBlocksCustomers()) {
      const pd = Math.hypot(nx - walk.x, nz - walk.z);
      if (pd > 0.01 && pd < 0.72) {
        nx = walk.x + ((nx - walk.x) / pd) * 0.72;
        nz = walk.z + ((nz - walk.z) / pd) * 0.72;
      }
    }
    return { x: nx, z: nz };
  }
  function settleCustomerCrowd() {
    _crowdBodies.length = 0;
    for (const c of customers) {
      if (!c.mesh || c.mesh.visible === false) continue;
      const slot = _crowdBodies.length;
      let body = _crowdBodyPool[slot];
      if (!body) {
        body = { x: 0, z: 0, radius: BODY_RADIUS, pinned: false, c: null };
        _crowdBodyPool[slot] = body;
      }
      body.x = c.mesh.position.x;
      body.z = c.mesh.position.z;
      body.radius = BODY_RADIUS;
      body.pinned = customerIsPinned(c);
      body.c = c;
      _crowdBodies.push(body);
    }
    if (_crowdBodies.length < 2) { crowdStats.pairsOverlapping = 0; return; }
    // Skip the whole solve on the overwhelmingly common frame where nobody is
    // near anybody. A cheap bounding test first keeps the O(n^2) separation off
    // the hot path in an empty or spread-out room.
    let anyClose = false;
    for (let i = 0; i < _crowdBodies.length && !anyClose; i += 1) {
      for (let j = i + 1; j < _crowdBodies.length; j += 1) {
        const a = _crowdBodies[i];
        const b = _crowdBodies[j];
        if (Math.abs(a.x - b.x) < 0.8 && Math.abs(a.z - b.z) < 0.8) { anyClose = true; break; }
      }
    }
    if (!anyClose) { crowdStats.pairsOverlapping = 0; return; }
    crowdStats.pairsOverlapping = separate(_crowdBodies, undefined, crowdClamp);
    crowdStats.passes += 1;
    let worst = 0;
    for (let i = 0; i < _crowdBodies.length; i += 1) {
      const body = _crowdBodies[i];
      for (let j = i + 1; j < _crowdBodies.length; j += 1) {
        const d = Math.hypot(body.x - _crowdBodies[j].x, body.z - _crowdBodies[j].z);
        if (d < BODY_RADIUS * 2) worst = Math.max(worst, BODY_RADIUS * 2 - d);
      }
      const mesh = body.c.mesh;
      if (mesh.position.x === body.x && mesh.position.z === body.z) continue;
      mesh.position.x = body.x;
      mesh.position.z = body.z;
      mesh.position.y = groundYAt(body.x, body.z) ?? heightAt(body.x, body.z);
    }
    crowdStats.worstOverlap = +worst.toFixed(4);
  }

  function crowdDiagnostics() {
    let pairs = 0;
    let worst = 0;
    const live = customers.filter((c) => c.mesh && c.mesh.visible !== false);
    for (let i = 0; i < live.length; i += 1) {
      for (let j = i + 1; j < live.length; j += 1) {
        const d = Math.hypot(
          live[i].mesh.position.x - live[j].mesh.position.x,
          live[i].mesh.position.z - live[j].mesh.position.z,
        );
        if (d < BODY_RADIUS * 2) { pairs += 1; worst = Math.max(worst, BODY_RADIUS * 2 - d); }
      }
    }
    return {
      people: live.length,
      pairs,
      worstOverlap: +worst.toFixed(4),
      touching: +(BODY_RADIUS * 2).toFixed(3),
      pinned: live.filter(customerIsPinned).length,
      passes: crowdStats.passes,
    };
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
    // PERSON-VS-PERSON IS NO LONGER RESOLVED HERE, and this loop is why the
    // owner kept photographing people standing inside each other. It pushed only
    // THIS customer out of the others, in array order, once per customer per
    // frame: A steps out of B, then B is updated and walks straight back into A.
    // Neither yields, the pair grinds, and which one wins depends on pool order.
    // settleCustomerCrowd() below replaces it with one simultaneous symmetric
    // pass over everybody after all of them have moved.
    return { nx, nz };
  }

  // NAV-BLOCK DIAGNOSTICS. Every stuck escalation in the walker loop records
  // what the customer was doing and which colliders boxed it in, so a failed
  // route is a report with positions instead of a silent freeze. Read through
  // navBlockDiagnostics(); the QA day runs assert against it.
  const navBlockLog = [];
  let navBlocksTotal = 0;
  // G2 — the no-progress high-water mark and how often the sliding branch was
  // the ONLY thing that flagged a customer. Both read by
  // navBlockDiagnostics(); see NAV_STUCK note above.
  let navProgressPeak = 0;
  let navSlidingRescues = 0;
  const debugFloorBoxCols = []; // QA-only: obstacles a driver dropped, so it can take them away
  function recordNavBlock(c, action, tx, tz, wp) {
    navBlocksTotal += 1;
    const near = [];
    for (const col of custCols) {
      if (c.mesh.position.x + 0.9 > col.minX && c.mesh.position.x - 0.9 < col.maxX
        && c.mesh.position.z + 0.9 > col.minZ && c.mesh.position.z - 0.9 < col.maxZ) {
        near.push({
          minX: +col.minX.toFixed(2),
          maxX: +col.maxX.toFixed(2),
          minZ: +col.minZ.toFixed(2),
          maxZ: +col.maxZ.toFixed(2),
          door: col.door === true,
        });
        if (near.length >= 6) break;
      }
    }
    const stop = c.stops[c.stopIdx] || null;
    const entry = {
      atMinute: +((state.clock?.minutes ?? 0) % 1440).toFixed(1),
      id: c.customerId ?? c.name,
      action,
      stopIdx: c.stopIdx,
      stopKind: stop?.kind ?? null,
      fixtureId: stop?.fixtureId ?? null,
      x: +c.mesh.position.x.toFixed(2),
      z: +c.mesh.position.z.toFixed(2),
      tx: +tx.toFixed(2),
      tz: +tz.toFixed(2),
      wpx: +((wp?.x ?? tx)).toFixed(2),
      wpz: +((wp?.z ?? tz)).toFixed(2),
      colliders: near,
    };
    navBlockLog.push(entry);
    if (navBlockLog.length > 300) navBlockLog.shift();
    console.warn(`[customer-nav] ${entry.id} ${action} at (${entry.x}, ${entry.z}) `
      + `→ stop ${entry.stopKind}${entry.fixtureId ? `:${entry.fixtureId}` : ''} (${entry.tx}, ${entry.tz})`);
  }

  // walkable grid around the building; doors are excluded (they open for walkers)
  const navCreateStartedAtMs = performance.now();
  const nav = makeNav({
    minX: center.x - 16, maxX: center.x + 16,
    minZ: center.z - 13, maxZ: center.z + 15,
    cell: 0.3, radius: 0.32,
  });
  const navCreatedAtMs = performance.now();
  const navCreateDurationMs = navCreatedAtMs - navCreateStartedAtMs;
  let navVersion = -1;
  // Goal 24 performance attribution. These monotonic counters are owned by the
  // shipping navigation path and have no reset or drive surface. They let an
  // Electron run prove that the route it calls "first" really paid (or avoided)
  // the first static-collider rebuild, while startup tracing retains the base
  // grid-construction cost separately.
  let navFreshCallCount = 0;
  let navRebuildCount = 0;
  let navRebuildTotalDurationMs = 0;
  let navRebuildMaximumDurationMs = 0;
  let navLastRebuildDurationMs = null;
  let navLastRebuildAtMs = null;
  function navFresh() {
    navFreshCallCount += 1;
    if (navVersion !== colVersion) {
      const rebuildStartedAtMs = performance.now();
      nav.rebuild(custCols.filter((c) => !c.door));
      const rebuildDurationMs = performance.now() - rebuildStartedAtMs;
      navRebuildCount += 1;
      navRebuildTotalDurationMs += rebuildDurationMs;
      navRebuildMaximumDurationMs = Math.max(
        navRebuildMaximumDurationMs,
        rebuildDurationMs,
      );
      navLastRebuildDurationMs = rebuildDurationMs;
      navLastRebuildAtMs = performance.now();
      navVersion = colVersion;
    }
    return nav;
  }

  function navPerformanceDiagnostics() {
    return Object.freeze({
      schemaVersion: 1,
      source: 'shipping-clubhouse-makeNav-and-navFresh-monotonic-counters',
      capturedAtMs: performance.now(),
      navCreateStartedAtMs,
      navCreatedAtMs,
      navCreateDurationMs,
      navFreshCallCount,
      navRebuildCount,
      navRebuildTotalDurationMs,
      navRebuildMaximumDurationMs,
      navLastRebuildDurationMs,
      navLastRebuildAtMs,
      colliderVersion: colVersion,
      builtColliderVersion: navVersion,
    });
  }

  // QA determinism: organic walk-ins spawn on a wall-clock probability that is independent
  // of the paused sim clock, so during a long automated acceptance run one can wander in,
  // pick a product up, and corrupt the exactly-once inventory/held assertions. The harness
  // turns this off for the duration of a scripted checkout; it defaults on for normal play.
  let organicWalkins = !shedPresentation; // no random customers walk into a maintenance shed

  // SIM-TIME-001. The clubhouse loop receives raw WALL dt at every game speed,
  // so before this every NPC quantity was wall-bound while the clock alone
  // sped up. Measured consequence (Greybox/data/speed-curve.json, one game hour
  // from 10:00): 1x completed 10 of 11 visits, 4x completed 0 of 11, 16x
  // completed 0 of 10. Speeding the clock made the shop EMPTIER, and every
  // above-1x day measurement in the repo describes an arrival-starved day.
  //
  // The ruled split (DEFECTS.md, 2026-07-28 — agreed, not re-litigated):
  //
  //   DECISIONS scale with the game clock. How long a shopper dwells at a
  //   fixture, how often someone walks in, how long they will wait before
  //   giving up: these are "how much of the day passed", and the day is what
  //   the speed control changes.
  //
  //   LOCOMOTION stays wall-rate, capped at ~4x. Bodies move faster as the day
  //   compresses, but never fast enough to step past a collider between frames.
  //
  //   FULL dt SCALING IS REJECTED. At 16x a customer walking 1.4 yd/s would
  //   cover 0.37 yd per frame at 60fps, against a 0.32-yd body radius — it
  //   tunnels, which is the exact class the corridor seals just closed.
  //
  // ANIMATION IS NOT A DECISION and stays on wall dt: character rigs, the
  // impatient beat, the bag-acceptance hold. Scaling those would make the
  // choreography unreadable at speed and buys nothing, since none of them
  // gate throughput.
  const LOCOMOTION_SPEED_CAP = 4;
  // THE PINNED REFERENCE. Locomotion is a LOOK, not a throughput knob: a customer
  // crossing the shop must read as a person walking, whatever length the day is.
  // This constant is what "wall rate" means here, and nothing derived from the
  // clock may stand in for it.
  //
  // That substitution is precisely how this broke on 2026-07-29. setSimSpeed took
  // ONE multiplier — the day's compression against the authored baseline — and
  // locomotion read `min(simSpeed, CAP)` off it. While the day was twelve hours
  // the compression was 1 and the two were indistinguishable. Shortening the day
  // to three hours made the compression 4, and every shopper began sprinting at
  // the cap on the DEFAULT rung. A cap is not a rate; reading a rate off a cap
  // only looks correct while the input happens to be 1.
  const LOCOMOTION_WALL_RATE = 1;
  let simSpeed = 1;
  let locomotionSpeed = LOCOMOTION_WALL_RATE;
  // Two multipliers, passed separately and on purpose.
  //
  //   decisionMult   — how fast the shop's DAY runs against the rate the NPC
  //                    timings were authored at. Day length feeds this one.
  //   locomotionMult — how fast the player asked the whole world to run. ONLY the
  //                    speed control feeds this one, and it is capped.
  //
  // Omitting the second argument yields wall rate — never a value derived from
  // the first. A caller that forgets can only ever make people walk at human
  // speed, which is the failure direction that is safe to ship.
  function setSimSpeed(decisionMult, locomotionMult) {
    simSpeed = Number.isFinite(decisionMult) && decisionMult > 0 ? decisionMult : 1;
    const requested = Number.isFinite(locomotionMult) && locomotionMult > 0
      ? locomotionMult
      : LOCOMOTION_WALL_RATE;
    locomotionSpeed = Math.min(requested, LOCOMOTION_SPEED_CAP);
  }
  const simTimeDiagnostics = () => ({
    simSpeed,
    locomotionCap: LOCOMOTION_SPEED_CAP,
    locomotionWallRate: LOCOMOTION_WALL_RATE,
    locomotionScale: locomotionSpeed,
  });

  // cached footfall target; -1 means "not solved this session yet"
  let footfallTargetMinute = -1;
  let footfallTarget = 0;

  function updateCustomers(dt) {
    // One fixture lookup table per frame (NAV-WAIT-001's wait poses need it by
    // id); a build-mode move or a sold-out display rebuilds it next frame.
    fixtureByIdCache = null;
    // How much of the shop's DAY passed this frame, and how far a body may move
    // in it. The two are deliberately different numbers above 4x.
    const decisionDt = dt * simSpeed;
    const moveDt = dt * locomotionSpeed;
    // Reservation arrivals share the same physical customer loop as retail
    // shoppers. Keep the persisted tee sheet authoritative, then materialize
    // every due party before advancing the floor routes below.
    updateArrivals();
    const minute = ((state.clock.minutes % 1440) + 1440) % 1440;
    // THE DOOR SIGN GATES ARRIVALS. Trading hours alone used to decide this, so
    // the shop opened itself at 6 AM whatever state the room was in. Now the
    // player flips the sign, and `open` false does exactly what closing time
    // already did — no new walk-ins, and anyone inside finishes and heads for
    // the exit (reservations and an in-progress transaction stay exempt below,
    // unchanged). See src/sim/shopSign.js.
    const open = shopAcceptsWalkIns(state, minute);
    // HOW BUSY THE SHOP IS, scaled by how the club is doing rather than by its
    // own output. See src/sim/shopFootfall.js for why yesterday's unit sales
    // were the wrong input: they are a mirror of footfall, so they locked it at
    // one. Recomputed once a game minute — shopCondition() walks the grime and
    // window arrays, which is not a per-frame cost worth paying for a number
    // that cannot meaningfully change inside a minute.
    // …keyed on the WHOLE minute. `minute` carries the frame's fraction, so
    // comparing it raw re-solved on almost every frame and the cache did
    // nothing at all.
    const wholeMinute = Math.floor(minute);
    if (open && wholeMinute !== footfallTargetMinute) {
      footfallTargetMinute = wholeMinute;
      footfallTarget = shopFootfallTarget(state, shopCustomerCapacity(state), { open: true });
    }
    const targetCount = open ? footfallTarget : 0;
    // Arrivals per GAME hour, not per wall second. This was the single biggest
    // contributor to the empty fast-forward shop: the roll fired on wall time,
    // so a 16x game hour rolled 1/16th as many times as a 1x one.
    // F1 (Goal 18): appointments are not footfall. A reservation guest at the
    // desk was counted against the organic target, so one booked arrival
    // crowded every walk-in shopper out of a floor-of-one room (measured:
    // the wired generator's first guest halved observed walk-ins).
    const organicCount = customers.filter((c) => c.reservationId == null).length;
    if (organicWalkins && open && organicCount < targetCount
        && Math.random() < Math.min(0.9, decisionDt * 0.15)) {
      const lifecycleBoundary = Object.freeze({
        schemaVersion: 1,
        eventType: 'organic-customer-lifecycle-window-start',
        lifecycleId: `organic-footfall:${++customerLifecycleSequence}`,
        atMs: performance.now(),
        source: 'shipping-organic-footfall-loop',
        spawnSource: 'organic-footfall',
        customerCountBefore: customers.length,
        organicCustomerCountBefore: organicCount,
      });
      emitGoal24NpcLifecycleBoundary(lifecycleBoundary);
      spawnCustomer(false, null, {
        allowWalkInRequest: true,
        spawnSource: 'organic-footfall',
        lifecycleBoundary,
      });
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
        // A SCRIPTED visit is an assertion by the caller, not a walk-in. When
        // the open/closed sign landed it started evicting these too, and every
        // harness that stages a shopper with sendToCounter() without also
        // flipping the sign began timing out waiting for a customer that had
        // quietly turned round and left (~20 drivers, including the checkout
        // render suite). The sign gates ARRIVALS; it must not delete a shopper
        // somebody explicitly placed.
        if (c.scriptedVisit) continue;
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
      if (char?.setPresentationDetail) {
        const dx = c.mesh.position.x - camera.position.x;
        const dz = c.mesh.position.z - camera.position.z;
        const wasFar = c.characterPresentationFar === true;
        // H4 (Goal 17) — THE POP WAS HAPPENING AT CONVERSATIONAL DISTANCE.
        //
        // Measured: the fine-detail meshes (brows, and the rest of the facial
        // set) switched off at sqrt(20.25) = 4.5 yd and back on at sqrt(16) =
        // 4.0 yd. There is hysteresis, so it does not flicker on the boundary -
        // but it is a hard visible/invisible flip, and 4.5 yd is the distance
        // you stand at to talk to somebody. Walk up to a customer and their
        // face arrives, which is exactly what H4 describes.
        //
        // The brief offers two answers: carry the features at distance, or
        // blend the swap. I am taking a third that is really the first, bounded:
        // push the swap out to where the features are too small to read, so the
        // moment it happens cannot be seen. A 12 mm brow at 4.5 yd is plainly
        // visible; at 9 yd it is a couple of pixels at this window size.
        //
        // NOT pushed to "never", deliberately. These are per-character meshes
        // and A1 measured this renderer as DRAW-CALL BOUND, so carrying them
        // across a whole crowd at any distance spends the exact currency the
        // game is short of. 9 yd out / 8 yd in doubles the range, puts the swap
        // well outside any conversation, and keeps the saving for the distant
        // crowd where it actually pays.
        const far = dx * dx + dz * dz > (wasFar ? 64 : 81);
        if (far !== wasFar) {
          c.characterPresentationFar = far;
          char.setPresentationDetail(far ? 'far' : 'full');
        }
      }
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
        // Patience is authored in real minutes but is a decision about the
        // shop's day: at 16x a customer must not wait sixteen game-hours for a
        // cashier just because the wall clock says ten minutes.
        c.preServiceWait = (c.preServiceWait || 0) + decisionDt;
        // A2 (Goal 21) — THE FRONT OF THE LINE NEVER LEAVES.
        //
        // A customer queues, waits while the player serves the person ahead,
        // reaches the front, and walks out before they can be served. Whatever
        // that modelled, what the player experiences is being punished for
        // doing the job correctly. Positions one and two are unconditional;
        // from third place back patience is real, and that is where the
        // pressure the game wants actually lives.
        //
        // THIS IS THE LIVE FUSE. The same rule was first written into
        // clubhouse/customers.js, which turns out to be imported by nothing —
        // see the note in section B of Report 21.
        if (c.preServiceWait > PATIENCE_FULL
          && queuePositionMayAbandon(counterQueue.indexOf(c))) {
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
        // F8 invariant (Full_Goal_16): nobody leaves with unpaid goods. This
        // net still heals the world (the goods go back), but a customer who
        // reaches the door with a WALK-IN DESK OUTCOME behind them is the
        // escape class F8 closed — that combination is a hard QA violation,
        // counted and shouted, never silent.
        if (c.combinedVisit && (c.walkInRejected || c.reservationReleased || c.reservationId != null)) {
          const msg = `[F8-INVARIANT] combined visitor "${c.fullName}" reached the ${stop.kind} `
            + `with ${c.cart.length} unpaid item(s) after a desk outcome`;
          console.error(msg);
          if (typeof window !== 'undefined') {
            window.__f8Violations = (window.__f8Violations || []);
            window.__f8Violations.push({ name: c.fullName, items: c.cart.length, kind: stop.kind });
          }
        }
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
        // B3 (Goal 23) — THE LINE ADVANCES WHEN THE FLOOR IS CLEAR, NOT WHEN
        // THE ARRAY IS. See queueAdvanceSlot in sim/customerSimulation.js for
        // why: splicing the served customer out moved everyone's target
        // instantly, while their body was still standing on it.
        const wanted = counterQueue.indexOf(c);
        const held = Number.isFinite(c.queueSlotHeld) ? c.queueSlotHeld : wanted;
        const bodies = [];
        for (const other of customers) {
          if (other === c || !other.mesh) continue;
          bodies.push({ x: other.mesh.position.x, z: other.mesh.position.z });
        }
        c.queueSlotHeld = queueAdvanceSlot(held, wanted, (idx) => (
          queueSlotIsClear(queueSlotW(idx), bodies)
        ));
        const slot = queueSlotW(c.queueSlotHeld);
        tx = slot.x;
        tz = slot.z;
      }

      // NAV-WAIT-001. Claim the stand on APPROACH, not from across the room: a
      // shopper still crossing the floor holds nothing, so the stand goes to
      // whoever actually gets there. Inside the approach band an unclaimed
      // stand is taken; a claimed one sends this shopper to a spaced hold point
      // facing it. `waitingForStand` then suppresses the arrival branch below,
      // because reaching a hold point is not reaching the stop.
      let waitingForStand = false;
      let waitFace = null;
      if (stop.kind === 'fixture' && stop.fixtureId) {
        pickStats.fixtureStopSeen += 1;
        if (c.fixtureClaim && c.fixtureClaim !== stop.fixtureId) releaseFixtureClaim(c);
        const holder = fixtureClaims.get(stop.fixtureId);
        const mine = holder === c;
        if (!mine) {
          const reach = Math.hypot(stop.x - c.mesh.position.x, stop.z - c.mesh.position.z);
          const holderGone = holder && !customers.includes(holder);
          if (holderGone) fixtureClaims.delete(stop.fixtureId);
          if (reach <= STAND_CLAIM_RADIUS) {
            if (!fixtureClaims.get(stop.fixtureId)) {
              pickStats.claimed += 1;
              fixtureClaims.set(stop.fixtureId, c);
              c.fixtureClaim = stop.fixtureId;
              c.waitSlot = null;
              c.waitFixtureId = null;
            } else {
              const fixture = fixtureById().get(stop.fixtureId);
              const slot = fixture ? waitSlotFor(c, stop.fixtureId) : null;
              if (fixture && slot != null) {
                const hold = fixtureWaitPose(fixture, slot);
                tx = hold.x;
                tz = hold.z;
                waitFace = hold;
                waitingForStand = true;
              } else {
                // No fixture record, or the crowd is full: give this stand up
                // rather than joining an unbounded scrum. Their remaining plan
                // still stands, and an empty plan simply heads for the exit.
                pickStats.standGivenUp += 1;
                if (!fixture) pickStats.noFixtureRecord += 1;
                releaseFixtureClaim(c);
                c.stopIdx += 1;
                c.path = [];
                c.pathGoal = null;
                c.linger = 0;
                continue;
              }
            }
          }
        }
      } else if (c.fixtureClaim) {
        releaseFixtureClaim(c);
      }

      const dx = tx - c.mesh.position.x;
      const dz = tz - c.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      // Reaching a HOLD POINT is not reaching the stop. Stand still, face the
      // display, and let the claim check above hand the stand over the moment
      // it frees — without ever running the browse/pick beat out here.
      if (waitingForStand) {
        if (dist < 0.18) {
          c.path = [];
          c.pathGoal = null;
          c.stuckT = 0;
          c.repathed = false;
          if (char) char.setMode(c.hasBasket ? 'BasketIdle' : 'Idle');
          if (waitFace) {
            const want = characterYawToward(
              c.mesh.position.x, c.mesh.position.z, waitFace.faceX, waitFace.faceZ,
            );
            let dy = want - c.mesh.rotation.y;
            while (dy > Math.PI) dy -= Math.PI * 2;
            while (dy < -Math.PI) dy += Math.PI * 2;
            c.mesh.rotation.y += dy * Math.min(1, dt * 8);
          }
          continue;
        }
      } else if (dist < 0.18) {
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
        // A reservation holder who also shopped is still an unpaid checkout
        // customer until the merchandise ticket owns those units. Keeping this
        // exclusion local to counter dispatch is deliberate: lifecycle checks
        // above still need openReservationCustomer(c) to protect an active
        // booking from closing-time or stale-status release. Once the cart is
        // paid, onCustomerPaid clears it and the combined desk result already
        // carried the green fee on that same ticket.
        } else if (stop.kind === 'counter' && openReservationCustomer(c)
            && !(c.cart?.length && !c.bought)) {
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
            // L1: the ask is SPOKEN — the monitor row then corroborates it
            c.dialogue = Number.isFinite(c.requestedTeeMinute)
              ? ((c.partySize || 1) > 1
                ? `Hi, could we get ${fmtSlot(c.requestedTeeMinute)} for ${c.partySize}?`
                : `Hi, could I get the ${fmtSlot(c.requestedTeeMinute)} tee time?`)
              : `Hi, do you have anything open for ${c.partySize || 1}?`;
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
          if (!c.awaitingCheckout && customerIsAtTheDesk(c)) {
            // One product crosses from their hands to the staging mat at a time.
            // Only after the last settles does registerMode take ownership.
            const placed = updateCustomerPlacement(c, dt);
            if (placed && !register.hasTx()) {
              c.onPaid = (transaction) => onCustomerPaid(c, transaction);
              c.onPaidOwnership = () => transferCustomerPaidOwnership(c);
              c.onPaidRelease = (transaction) => releasePaidCustomerFromCheckout(c, transaction);
              c.onPaidReleaseAuthoritative = () => (
                releasePaidCustomerFromCheckoutAuthoritative(c)
              );
              // B2 (Goal 23): the register owns the barcode, clubhouse owns the
              // person, so the register says WHEN the goods are all scanned and
              // this decides what the person does about it.
              c.onGoodsScanned = () => raiseDeskErrandAtCounter(c);
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
            if (['ChoosingPayment', 'CardPresented', 'CardInsertReady', 'CardInserting',
              'CardAmountEntry', 'CardProcessing', 'CardApproved', 'CashPresented',
              'PaymentComplete', 'ReceiptPrinting'].includes(flowState)) {
              checkoutMode = 'Present';
              // F6 (Full_Goal_16): cash goes DOWN and the arm comes back —
              // once the tender fan has landed (the fly-in runs ~0.6 s from
              // CashPresented entry) the customer settles to await change.
              // The card keeps the held-out reach until it is taken; after
              // PaymentComplete both methods stand settled.
              const flowAgeMs = flowNow() - (c.checkoutFlow?.enteredAtMs || 0);
              if (flowState === 'CashPresented' && flowAgeMs > 900) checkoutMode = 'CashLaid';
              if (flowState === 'PaymentComplete') checkoutMode = 'CashLaid';
            }
            else if (flowState === 'CardDeclined') checkoutMode = 'Declined';
            else if (['SelectingChange', 'GivingChange'].includes(flowState)) checkoutMode = 'Receive';
            else if (['Bagging', 'BagHandoff'].includes(flowState)) checkoutMode = 'ReceiveBag';
            char.setMode(checkoutMode);
            c.qaPoseMode = checkoutMode; // read-only QA breadcrumb (F6 driver)
          }
          if (c.patience <= 0) beginCustomerImpatientBeat(c);
        } else if (!served) {
          if (char) char.setMode('Idle');
        } else if (!isPass && c.linger > 0) {
          if (char) {
            if (stop.kind === 'basket') char.setMode('BasketPickup');
            else if (stop.kind === 'fixture') char.setMode(c.hasBasket ? 'BasketBrowse' : 'Browse');
            else char.setMode(c.hasBasket ? 'BasketIdle' : 'Idle');
          }
          c.linger -= decisionDt; // browse dwell is game-clock time
        } else {
          if (stop.kind === 'basket') {
            if (!takeBasket(c)) {
              c.plansBasket = false;
              c.plannedCount = 1;
            }
          }
          // done browsing — the stand goes back to whoever is holding for it
          if (stop.kind === 'fixture') {
            customerPick(c, stop);
            releaseFixtureClaim(c);
          }
          if (stop.kind === 'lounge' && c.reservationId != null) {
            c.checkoutPhase = 'reservation-arriving';
            c.currentDestination = 'front-desk';
            const reservation = reservationRecordForCustomer(c);
            if (reservation) reservation.currentDestination = 'front-desk';
          }
          if (stop.kind === 'counter') leaveQueue(c);
          c.stopIdx++;
          const next = c.stops[c.stopIdx];
          c.linger = next && next.duration ? next.duration : 1.5 + Math.random() * 3.5;
          if (c.stopIdx >= c.stops.length) {
            removeCustomer(i);
            continue;
          }
        }
        if (stop.faceX !== undefined) {
          const want = characterYawToward(
            c.mesh.position.x,
            c.mesh.position.z,
            stop.faceX,
            stop.faceZ,
          );
          let dy = want - c.mesh.rotation.y;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          c.mesh.rotation.y += dy * Math.min(1, dt * 6);
        }
      } else {
        if (char) char.setMode(c.bagMesh ? 'WalkBag' : 'Walk');
        // path on destination change only; string-pulled waypoints thereafter
        if (!c.pathGoal || Math.hypot(c.pathGoal.x - tx, c.pathGoal.z - tz) > 0.22) {
          const requestedAtMs = performance.now();
          const requestId = `${c.customerId}:${++customerRouteSequence}`;
          c.path = navFresh().path(c.mesh.position.x, c.mesh.position.z, tx, tz) || [{ x: tx, z: tz }];
          // Goal 24 evidence must describe THIS request, not whatever the
          // process-wide counter says when an asynchronous observer happens to
          // poll later. A second customer can legitimately request a route in
          // that gap. Snapshot immediately after the shipping navFresh().path
          // call and bind it to immutable route/customer/lifecycle identities.
          const navPerformanceAtResolution = Object.freeze({
            ...navPerformanceDiagnostics(),
            routeRequestId: requestId,
            customerId: c.customerId,
            lifecycleBoundaryId: c.lifecycleBoundaryId,
          });
          const resolvedAtMs = navPerformanceAtResolution.capturedAtMs;
          c.routeDiagnostics = {
            requestId,
            customerId: c.customerId,
            requestedAtMs,
            resolvedAtMs,
            pathNodes: c.path.length,
            goal: { x: tx, z: tz },
            spawnSource: c.spawnSource,
            lifecycleBoundaryId: c.lifecycleBoundaryId,
            lifecycleBoundaryAtMs: c.lifecycleBoundaryAtMs,
            navPerformanceAtResolution,
          };
          c.pathGoal = { x: tx, z: tz };
          c.stuckT = 0;
          // a new destination means the old best distance means nothing
          c.bestGoalDist = Infinity;
          c.noProgressT = 0;
        }
        while (c.path.length > 1
          && Math.hypot(c.path[0].x - c.mesh.position.x, c.path[0].z - c.mesh.position.z) < 0.3) {
          c.path.shift();
        }
        const wp = c.path[0] || { x: tx, z: tz };
        const wdx = wp.x - c.mesh.position.x;
        const wdz = wp.z - c.mesh.position.z;
        const wdist = Math.hypot(wdx, wdz) || 1;
        const step = Math.min(wdist, c.speed * moveDt); // capped: see LOCOMOTION_SPEED_CAP
        // B (Goal 21) — LOOK BEFORE STEPPING, IN THE CODE THAT ACTUALLY RUNS.
        //
        // resolveCustomer below is penetration resolution: it can only push a
        // walker back out of something it is already inside, which is why a
        // shopper grinds along a shelf end until the stuck timer notices. The
        // look-ahead turns the heading first, by the smallest angle that clears.
        //
        // This was written last session into clubhouse/customers.js, which is
        // imported by NOTHING — eight headless tests passed against a module the
        // game never loads. That is why the owner still watched customers walk
        // into things. Same code, now on the live path.
        _steerCustomer = c;
        let heading = steerAround(
          c.mesh.position.x, c.mesh.position.z, wdx, wdz, wdist, _customerBlockedAt,
        );
        // ...and then the PEOPLE, with their velocities. steerAround treats a
        // person as a static blocked disc and switches off entirely below
        // STEER_DEFAULTS.minTravel, which is the exact range at which two people
        // are about to collide. This is reciprocal -- both parties run it on the
        // same frame and each takes half the correction -- which is what makes
        // them step past one another instead of both dodging the same way.
        const crowdNear = customerNeighbours(c);
        let crowdSlow = 1;
        if (crowdNear.length) {
          const avoid = avoidanceHeading(
            { x: c.mesh.position.x, z: c.mesh.position.z, vx: c.vx || 0, vz: c.vz || 0 },
            crowdNear, heading.x, heading.z, Math.max(0.2, step / Math.max(dt, 1e-4)),
          );
          if (avoid.avoided) {
            heading = { ...heading, x: avoid.x, z: avoid.z, steered: true };
            // YIELD, do not just swerve. A sidestep at full stride through a
            // tight gap still reads as barging; people slow down when a
            // collision is imminent. Urgency > 2 is the overlapping band in
            // avoidanceHeading; above ~1.2 the closest approach is inside half
            // a second. Scaling the step is what makes two crossing walkers
            // resolve as one yielding to the other rather than both wedging
            // into the same gap at speed.
            const urgency = avoid.threat?.urgency ?? 0;
            if (urgency >= 2) crowdSlow = 0.35;
            else if (urgency > 1.2) crowdSlow = 0.6;
          }
        }
        steerStats.calls += 1;
        if (wdist > STEER_DEFAULTS.minTravel) steerStats.engaged += 1; else steerStats.tooShort += 1;
        if (heading.steered) steerStats.steered += 1;
        if (heading.trapped) steerStats.trapped += 1;
        steerStats.travelSum += wdist;
        if (wdist > steerStats.travelMax) steerStats.travelMax = wdist;
        const res = resolveCustomer(
          c,
          c.mesh.position.x + heading.x * step * crowdSlow,
          c.mesh.position.z + heading.z * step * crowdSlow,
        );
        const moved = Math.hypot(res.nx - c.mesh.position.x, res.nz - c.mesh.position.z);
        // Velocity, so the people around this one can see where it is GOING
        // rather than only where it is standing. Without it two walkers each
        // dodge a body that will not be there by the time they arrive.
        if (dt > 1e-6) {
          c.vx = (res.nx - c.mesh.position.x) / dt;
          c.vz = (res.nz - c.mesh.position.z) / dt;
        }
        c.mesh.position.x = res.nx;
        c.mesh.position.z = res.nz;
        c.mesh.rotation.y = characterYawToward(
          c.mesh.position.x,
          c.mesh.position.z,
          wp.x,
          wp.z,
        );
        // stuck detection: 1.2s pinned → one repath against the fresh world;
        // every further 3s pinned climbs an escalation ladder, and every rung is
        // logged with positions and the surrounding colliders. Rungs 1-2 keep
        // the old random sidestep; rung 3 nudges the walker onto the nearest
        // cell the nav grid believes open (wedged in collision the grid can't
        // see); rung 4 projects the TARGET to its nearest reachable point (the
        // stand point itself is inside an inflated collider, so arrival could
        // never happen); rung 5 abandons the stop rather than freeze the day.
        // ITEM 14 (2026-08-06): "they run into the box at the top left forever.
        // Find why the recovery ladder never fires on that obstacle."
        //
        // Because the ladder's only stuck test is DISPLACEMENT — did I move a
        // quarter of the step I asked for. Walk into a corner and you move
        // nothing, so it fires. Walk into the flat FACE of a box and
        // resolveCustomer slides you along it: you move most of your step,
        // every frame, forever, and `moved < step * 0.25` is never true. The
        // ladder was never reached on that obstacle, so none of its five rungs
        // could help. The shape of the prop decided whether recovery existed.
        //
        // Displacement is the wrong question. The right one is PROGRESS: is the
        // target getting closer. A customer grinding along a box face is moving
        // and getting nowhere, and that is what the ladder needs to hear.
        const goalDist = Math.hypot(tx - c.mesh.position.x, tz - c.mesh.position.z);
        if (!Number.isFinite(c.bestGoalDist) || goalDist < c.bestGoalDist - NAV_PROGRESS_EPSILON_YD) {
          c.bestGoalDist = goalDist;
          c.noProgressT = 0;
        } else {
          c.noProgressT = (c.noProgressT || 0) + dt;
        }
        // G2: the verdict is a pure function now, so the claim item 14 was
        // built on — "there are states displacement cannot see and progress
        // can" — is something a test can drive both branches of directly
        // instead of something the sim has to be caught doing.
        const verdict = navStuckVerdict({ moved, step, noProgressT: c.noProgressT });
        // ...and the high-water mark of every customer's no-progress clock,
        // whether or not it ever crossed the threshold. Report 14 could only say
        // "the branch never fired"; this says how close it came.
        if (c.noProgressT > navProgressPeak) navProgressPeak = c.noProgressT;
        // the frames where progress WOULD have been the only signal. Zero in
        // every run so far; the number is what would reopen the branch.
        if (verdict.wouldSlide && !verdict.stuck) navSlidingRescues += 1;
        if (verdict.stuck) {
          c.stuckT = (c.stuckT || 0) + dt;
          // F2: a wrong ROUTE gets acted on within ~a beat of the 1 s verdict;
          // a displacement scrape keeps the patient 3 s gate (its sidesteps
          // are cheap but jittery when too eager).
          const ladderGate = verdict.reason === 'no-progress' ? 0.35 : 3.0;
          if (c.stuckT > ladderGate) {
            c.stuckEscalation = (c.stuckEscalation || 0) + 1;
            // G10: "Not a nudge, not a repath along the same line: a genuinely
            // different path, and if none exists, they abandon that stop."
            //
            // A displacement stall means the walker is against something and a
            // sidestep usually clears it, so that keeps the full ladder. Three
            // seconds of NO PROGRESS means the route is wrong, and sidestepping
            // a wrong route just wastes two more rungs against it - so this
            // reason enters the ladder at the RETARGET rung and escalates to
            // abandoning the stop from there.
            if (verdict.reason === 'no-progress' && c.stuckEscalation < 3) {
              c.stuckEscalation = 3;
            }
            // F2: "a genuinely different route". The nudge rung repositions
            // and repaths, but the fresh path can lead straight back through
            // the same blocked waypoint — the sidestep/nudge/retarget trio
            // looping at one shelf in the logs is that cycle. Ban the
            // waypoint the stall happened at: if the next path leads there
            // again, skip straight to moving the TARGET instead.
            if (verdict.reason === 'no-progress' && c.bannedWp
              && Math.hypot(c.bannedWp.x - wp.x, c.bannedWp.z - wp.z) < 0.5) {
              c.stuckEscalation = Math.max(c.stuckEscalation, 4);
            }
            if (verdict.reason === 'no-progress') c.bannedWp = { x: wp.x, z: wp.z };
            const rung = Math.min(5, c.stuckEscalation);
            recordNavBlock(c, ['sidestep', 'sidestep', 'nudge', 'retarget', 'skip'][rung - 1], tx, tz, wp);
            if (rung <= 2) {
              const side = Math.random() < 0.5 ? 1 : -1;
              const sres = resolveCustomer(c, c.mesh.position.x + (wdz / wdist) * 0.6 * side, c.mesh.position.z - (wdx / wdist) * 0.6 * side);
              c.mesh.position.x = sres.nx;
              c.mesh.position.z = sres.nz;
            } else if (rung === 3) {
              const open = navFresh().nearestOpenWorld(c.mesh.position.x, c.mesh.position.z, 6);
              if (open) {
                const nres = resolveCustomer(c, open.x, open.z);
                c.mesh.position.x = nres.nx;
                c.mesh.position.z = nres.nz;
              }
            } else if (rung === 4 && stop && stop.kind !== 'counter') {
              // Queue geometry belongs to the counter; every other stop may move
              // to the nearest point the grid can actually deliver a walker to.
              const open = navFresh().nearestOpenWorld(tx, tz, 6);
              if (open && Math.hypot(open.x - tx, open.z - tz) > 0.05) {
                stop.x = open.x;
                stop.z = open.z;
              }
            } else if (rung >= 5 && stop && stop.kind !== 'exit' && stop.kind !== 'gone') {
              if (stop.kind === 'counter') leaveQueue(c);
              // F2: "if they cannot find any way to reach what they want,
              // tell me. I should never have a customer silently stuck in my
              // shop without knowing." The bell carries it; the dedupe key
              // keeps one report per customer+stop, not a stream.
              try {
                notify(state, {
                  kind: 'shop',
                  text: t('shop.customerGaveUpStop', { name: c.name || 'A customer', what: stop.kind }),
                  dedupeKey: `nav-giveup:${c.id}:${c.stopIdx}`,
                });
              } catch { /* a notification must never take the walker down */ }
              c.stopIdx += 1;
              c.stuckEscalation = 0;
              c.bannedWp = null;
            }
            c.pathGoal = null;
            c.stuckT = 0;
            c.repathed = false;
            // a rung has just moved them or their target; give the progress
            // test a fresh baseline or it re-fires on the next frame
            c.bestGoalDist = Infinity;
            c.noProgressT = 0;
          } else if (c.stuckT > 1.2 && !c.repathed) {
            c.pathGoal = null;
            navVersion = -1; // rebake — a door or hauled pile may have changed the world
            c.repathed = true;
          }
        // G2: the clear-the-stuck-clock arm used to hold off while the progress
        // clock was over its threshold. With `sliding` no longer a stuck reason
        // that guard would keep a genuinely walking customer's escalation state
        // alive for no reason, so it goes with the branch it belonged to.
        } else if (moved > step * 0.6) {
          c.stuckT = 0;
          c.repathed = false;
          c.stuckEscalation = 0;
        }
      }
      c.mesh.position.y = groundYAt(c.mesh.position.x, c.mesh.position.z) ?? heightAt(c.mesh.position.x, c.mesh.position.z);
    }
    // AFTER everyone has moved, not during: this is the pass that guarantees no
    // two people are left standing inside each other, whatever order the pool
    // happened to update them in.
    settleCustomerCrowd();
  }

  // --- per-frame update -------------------------------------------------------------------
  let now = 0;
  let poll = 0;
  let visClock = 0;
  const CEILING_LIGHT_NORMAL_BUDGET = 16;
  const CEILING_LIGHT_DENSE_BUDGET = 6;
  const ceilingLightBudgetPoint = new THREE.Vector3();
  let ceilingLightBudgetClock = 0;
  let ceilingLightBudgetState = Object.freeze({
    limit: CEILING_LIGHT_NORMAL_BUDGET,
    fixtureCount: 0,
    poweredFixtureCount: 0,
    requestedPhysicalLights: 0,
    allocatedPhysicalLights: 0,
  });

  function updatePlacedCeilingLightBudget(dt, force = false) {
    ceilingLightBudgetClock += dt;
    if (!force && ceilingLightBudgetClock < 0.2) return false;
    ceilingLightBudgetClock = 0;
    const rows = [];
    for (const decor of decorObjs) {
      const controller = decor.group.userData.ceilingLightController;
      if (!controller) continue;
      const max = controller.maxPhysicalLights();
      decor.group.getWorldPosition(ceilingLightBudgetPoint);
      rows.push({
        controller,
        max,
        powered: controller.isOn() && controller.isCircuitPowered(),
        distanceSq: ceilingLightBudgetPoint.distanceToSquared(camera.position),
      });
    }
    rows.sort((left, right) => left.distanceSq - right.distanceSq);
    const allocations = new Map(rows.map((row) => [row.controller, 0]));
    const limit = rows.length > 10 ? CEILING_LIGHT_DENSE_BUDGET : CEILING_LIGHT_NORMAL_BUDGET;
    let remaining = limit;
    // Nearby fixtures receive one real pool before multi-head fixtures receive
    // additional authored beams. Six-fixture normal gameplay uses only 13 and
    // remains completely unbudgeted. In unusually dense rooms the six nearest
    // pools follow the player while every switched-on fixture stays emissive.
    while (remaining > 0) {
      let allocatedThisPass = false;
      for (const row of rows) {
        if (!row.powered || allocations.get(row.controller) >= row.max) continue;
        allocations.set(row.controller, allocations.get(row.controller) + 1);
        remaining -= 1;
        allocatedThisPass = true;
        if (remaining <= 0) break;
      }
      if (!allocatedThisPass) break;
    }
    let changed = false;
    for (const row of rows) {
      changed = row.controller.setPhysicalLightBudget(allocations.get(row.controller)) || changed;
    }
    ceilingLightBudgetState = Object.freeze({
      limit,
      fixtureCount: rows.length,
      poweredFixtureCount: rows.filter((row) => row.powered).length,
      requestedPhysicalLights: rows
        .filter((row) => row.powered)
        .reduce((sum, row) => sum + row.max, 0),
      allocatedPhysicalLights: [...allocations.values()].reduce((sum, count) => sum + count, 0),
    });
    return changed;
  }

  // Render-only visibility sync. Prewarm uses this after applying an editor
  // camera so the shader draw sees the same PointLight set as the first live
  // editor frame, without advancing customers, deliveries, or checkout state.
  function syncCameraVisibility() {
    // Prewarm intentionally does not call update(), so this render-only path
    // must still apply the simulation-owned circuit gate before it certifies a
    // light-count shader signature. Otherwise fresh campaign boot draws the
    // hidden/detail set as powered (6 point / 2 area) and the first live door
    // frame requests the real unpowered signature.
    syncCeilingCircuitPower();
    // Resort hero views sit farther from the larger 4,000 sq ft shell. Past
    // this distance its saved furniture is no longer legible through the
    // glazing, so avoid submitting the complete checkout/retail fit-out and
    // its lights to every exterior frame. Near-window and indoor views retain
    // the normal player-owned interior authority.
    const resortPresentationEnabled = typeof resortClubhouse.enabled === 'function'
      && resortClubhouse.enabled();
    const interiorDrawDistance = resortPresentationEnabled ? 34 : CLUBHOUSE_INTERIOR_DRAW_DISTANCE;
    // THE ROOM YOU ARE STANDING IN MUST NOT VANISH BECAUSE THE CAMERA IS
    // ELSEWHERE. This asked the CAMERA where it was, and on the way back from
    // the overview the camera is still out over the course for several frames
    // while it returns to the player. For those frames the fit-out is culled and
    // what remains on screen is the bare authored shell -- green walls, carpet,
    // a window, no counter and no fixtures -- which is exactly the owner's
    // "it shows the dummy map before my grey one", and why it only happens on
    // Tab-then-Tab-again rather than on the way in. Recorded and viewed at
    // qa/tab-map/frames/frame-0371.png.
    //
    // While walking, the PLAYER's position is the authority: they are the reason
    // the interior is being drawn at all. The camera keeps its say for every
    // other view, which is what the draw-distance saving was measured on.
    const visible = clubhouseInteriorVisibleAt(
      camera.position.x,
      camera.position.z,
      center.x,
      center.z,
      interiorDrawDistance,
    ) || (walk.active && clubhouseInteriorVisibleAt(
      walk.x,
      walk.z,
      center.x,
      center.z,
      interiorDrawDistance,
    ));
    // Visual-evidence scripts may isolate the permanent authored shell from a
    // player's saved furniture. The flag never changes simulation or save data.
    interior.visible = interior.userData.visualQaForceHidden ? false : visible;
    shell.lighting.setCameraLocalPosition(
      camera.position.x - center.x,
      camera.position.z - center.z,
    );
    props61to100.setCameraVisibility(
      camera.position.x - center.x,
      camera.position.z - center.z,
    );
    return visible;
  }

  function update(dtMs) {
    const dt = Math.min(0.1, dtMs / 1000);
    now += dt;
    // Both signs, from one fact. sync() compares two booleans and returns; it
    // only touches a canvas or starts a swing when signIsOpen(state) has
    // actually moved — including when the midnight rollover moved it, which is
    // the case nothing used to notice.
    syncOpenClosedSigns();
    // the door sign's flip animation (a no-op unless it is mid-swing)
    shopSign.tickSpin(dt);
    // Campaign arrival events. The objective list and the arrival phase gate
    // read campaign.events, and nothing else records them: porch contact (or
    // the immediate approach) marks the walk-up, crossing the interior
    // threshold marks entry. Both no-op instantly outside an active campaign.
    if (state.campaign?.enabled && !state.campaign.events?.enteredClubhouse && walk?.active) {
      if (isInside(walk.x, walk.z, -0.04)) {
        recordCampaignEvent(state, 'walkedToClubhouse');
        recordCampaignEvent(state, 'enteredClubhouse');
      } else if (!state.campaign.events?.walkedToClubhouse
          && (onPorch(walk.x, walk.z) || isInside(walk.x, walk.z, 1.2))) {
        recordCampaignEvent(state, 'walkedToClubhouse');
      }
    }
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
    mountainLodge.update(dt);
    modernClubhouse.update(dt);
    resortClubhouse.update(dt);
    props61to100.update(dt);
    updateFixtures(dt);
    pineHillsInterior.update(dt);
    // Under shed, detailInterior is the shed interior (pineHillsInterior is the
    // dormant stub). Its update drives cobweb sway + the completion watch, which
    // must fire even when the last clean is a floor mop (that bypasses the
    // discrete-target pre-gate).
    if (shedPresentation && detailInterior?.update) detailInterior.update(dt);
    architecturalDoorInstallation.update(dt);
    updateDoors(dt, now);
    for (const decor of decorObjs) {
      const movedComponent = decor.group.userData.update?.(dt);
      if (movedComponent) {
        for (const updateCollider of decor.dynamicColliderUpdates || []) updateCollider();
        if (decor.dynamicColliderUpdates?.length) colVersion++;
      }
    }
    updatePlacedCeilingLightBudget(dt);
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
    if (ledgerBook.isCarried()) {
      // the carried book rides one forearm's length ahead, waist high
      const off = interior.position;
      ledgerBook.followCarry({
        x: walk.x - Math.sin(walk.yaw) * 0.52 - off.x,
        z: walk.z - Math.cos(walk.yaw) * 0.52 - off.z,
        y: 0.98,
        ry: walk.yaw,
      });
    }
    ledgerBook.update(dt);
    updateStockFlights(dt);
    updateBoxLifecycleAnimations(dt);
    updateRecyclingDrop(dt);
    updateFlicker(dt);
    builder.update(dtMs);
    if (office.updateLid) office.updateLid(dt);
    if (moteFade > 0) {
      moteFade -= dt;
      if (moteFade <= 0) motes.visible = false;
    }
    updateVacuumChunks(dt);
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
    // Run this last: legacy async runtimes can toggle their own visibility and
    // interaction registrations earlier in the frame. Premium architecture owns
    // the presentation, while the operable member doors and genuine player-
    // placed furnishings remain part of normal gameplay.
    premiumCountryClub.update(dt);
    if (premiumCountryClub.root()) {
      for (const collider of [...registeredCols]) {
        const keep = collider.premiumCountryClub === true
          || (collider.door === true && collider.mainEntrance === true)
          || collider.playerPlacedFurniture === true;
        if (!keep) removeCol(collider);
      }
      for (const prop of [...registeredProps]) {
        const keep = prop.premiumCountryClubPreserve === true
          || prop.playerPlacedFurniture === true;
        if (!keep) removeProp(prop);
      }
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
    // Cancel the presentation barrier before any constituent runtime releases
    // its roots. This clears the deadline and diagnostic closures, and resolves
    // an unsafe disposed report for an in-flight prewarm instead of retaining
    // this clubhouse until timeout.
    const firstDoorVisibilityReadyDisposal = firstDoorVisibilityReady.dispose?.() ?? false;
    register.leave({ restorePointer: false });
    disposeFixtures();
    props61to100.stopAnimations();
    // Snapshot borrowed identities before their owning runtimes clear their
    // caches. The prop runtime may reference the same GLTF resources but must
    // never release another runtime's ownership.
    props61to100ProtectedAtDisposal = mergeRenderableResources(
      protectedRenderableResources,
      sheet06Production.borrowedResources?.(),
      architecturalDoorInstallation.ownedResources?.(),
    );
    const premiumCountryClubDisposal = premiumCountryClub.dispose();
    const resortClubhouseDisposal = resortClubhouse.dispose();
    const mountainLodgeDisposal = mountainLodge.dispose();
    const modernClubhouseDisposal = modernClubhouse.dispose();
    const sheet06ProductionDisposal = sheet06Production.dispose();
    const architecturalDoorsDisposal = architecturalDoorInstallation.dispose();
    // Runtime roots are protected from the outer procedural walk below, then
    // released through their own ownership boundary after that walk completes.
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
    // Six customer-card canvases deliberately stay cached after the opaque GPU
    // warm-up. They are not all reachable from the scene graph, so the register
    // releases that explicit ownership ledger before the broad resource walk.
    const registerDisposal = register.dispose?.() || null;

    const equipmentBorrowedResources = deliveryEquipment?.borrowedResources?.() || null;
    clearDeliveryVanColliders();
    const deliveryEquipmentDisposal = deliveryEquipment?.dispose?.() || null;
    deliveryArrivalHandles.clear();
    deliveryArrivalPresentations.clear();

    const staticRoots = [
      group, interior, custGroup, motes, chunkPoints, boxGroup, carriedBoxHands,
      washing.jet, washing.mist,
      ...(ctx.extraMeshes || []),
    ];
    const looseResources = mergeRenderableResources(
      materialKitResources,
      collectMaterialResources([
        cardboardDark, tapeMat, paperMat, shipLabelMat, ghostMat,
        ...labelCache.values(), ...skuMats.values(), ...ballBoxMats.values(),
        ...snackLabelMats.values(), ...drinkMats.values(),
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
      // Protect the complete runtime group, including its sibling global
      // static batch. Its dispose() releases runtime-owned GLTF/batch resources
      // while leaving merch-baked geometry to the merchandise cache.
      collectRenderableResources(props61to100.group),
      // The Pine Hills dressing uses CachedGLTFLoader clones.  The cache owns
      // their shared GLB resources; this outer procedural walk owns only the
      // boards, signs, and other geometry created in this clubhouse instance.
      collectRenderableResources(pineHillsInterior.roots()),
      // Shed presentation has two explicit raw-resource owners nested beneath
      // the broad shell/interior roots. Protect exactly their owned ledgers
      // here; each runtime releases its resources once below. ShedInterior's
      // ledger deliberately excludes borrowed clubhouse materials.
      shedInterior?.ownedResources?.(),
      dirt.ownedResources?.(),
    );

    camera.remove(carriedBoxHands);
    scene.remove(group, interior, custGroup, motes, chunkPoints, boxGroup, washing.jet, washing.mist);
    for (const p of [...registeredProps]) removeProp(p);
    for (const c of [...registeredCols]) removeCol(c);
    for (const m of ctx.extraMeshes || []) scene.remove(m);

    // Release procedural/static resources once, while loader-owned clone data
    // remains exclusively under createMerch's ownership boundary.
    const procedural = disposeRenderableResources(ownedResources, protectedResources);
    // Flip the runtime's disposed guard before any late GLTF callback can
    // mount a root or register a collider during reload-only recovery. The
    // whole runtime group was protected above, while merch-owned baked
    // geometry stays protected inside this disposal until merch.dispose().
    const props61to100Disposal = props61to100.dispose();
    const pineHillsInteriorDisposal = pineHillsInterior.dispose();
    // Under shed, release the shed's own minted content (interior nodes + grime
    // plane / window films). Under every other variant these are no-ops.
    const shedInteriorDisposal = shedPresentation ? detailInterior?.dispose?.() : null;
    const shedDirtDisposal = shedPresentation ? dirt.dispose?.() : null;
    const merchandise = merch.dispose ? merch.dispose() : null;
    deliveryEquipment = null;
    boxPlacementMode = null;
    disposalSummary = Object.freeze({
      procedural,
      merchandise,
      register: registerDisposal,
      firstDoorVisibilityReady: firstDoorVisibilityReadyDisposal,
      deliveryEquipment: deliveryEquipmentDisposal,
      boxPlacement: boxPlacementDisposal,
      premiumCountryClub: premiumCountryClubDisposal,
      resortClubhouse: resortClubhouseDisposal,
      mountainLodge: mountainLodgeDisposal,
      modernClubhouse: modernClubhouseDisposal,
      sheet06Production: sheet06ProductionDisposal,
      architecturalDoors: architecturalDoorsDisposal,
      props61to100: props61to100Disposal,
      pineHillsInterior: pineHillsInteriorDisposal,
      shedInterior: shedInteriorDisposal,
      shedDirt: shedDirtDisposal,
    });
    return disposalSummary;
  }

  return {
    group, interior,
    // The building-local origin. Every coordinate in shopLayout is expressed
    // against this, and colliders are stored in world space, so any audit that
    // wants to say "this prop is at local (x, z)" needs it. `interior.position`
    // is NOT a substitute — it is a scene-graph node with its own offset, and
    // using it as the origin silently reports every collider in the wrong place.
    center: Object.freeze({ x: center.x, z: center.z }),
    localToWorld: (lx, lz) => L2W(lx, lz),
    worldToLocal: (wx, wz) => W2L(wx, wz),
    update, syncCameraVisibility, syncCeilingCircuitPower,
    rebuildStock, rebuildReno, refreshCondition, repaintGrime,
    repaintWash: () => washing.repaintAll(),
    rebuildBoxes, presentDeliveryArrival, renderDeliveryCarryOverlay,
    sheet06Production: sheet06ProductionPublic,
    sheet06ProductionReady: () => sheet06Production.ready,
    firstDoorVisibilityReady,
    architecturalDoors: Object.freeze({
      ready: architecturalDoorInstallation.ready,
      diagnostics: () => architecturalDoorInstallation.diagnostics(),
      sync: () => architecturalDoorInstallation.syncServiceDoors(),
      holders: () => architecturalDoorInstallation.holders(),
      createStressSet: (options) => architecturalDoorInstallation.createStressSet(options),
      setStressVisible: (visible) => architecturalDoorInstallation.setStressVisible(visible),
      forceStressLod: (level) => architecturalDoorInstallation.forceStressLod(level),
    }),
    modernClubhouse: Object.freeze({
      ready: modernClubhouse.ready,
      diagnostics: () => modernClubhouse.diagnostics(),
      roots: () => modernClubhouse.roots(),
    }),
    mountainLodge: Object.freeze({
      ready: mountainLodge.ready,
      diagnostics: () => mountainLodge.diagnostics(),
      root: () => mountainLodge.root(),
    }),
    resortClubhouse: Object.freeze({
      ready: resortClubhouse.ready,
      diagnostics: () => resortClubhouse.diagnostics(),
      root: () => resortClubhouse.root(),
    }),
    premiumCountryClub: Object.freeze({
      ready: premiumCountryClub.ready,
      diagnostics: () => premiumCountryClub.diagnostics(),
      root: () => premiumCountryClub.root(),
    }),
    sheet07Production: {
      ready: sheet07Production.ready,
      diagnostics: () => sheet07Production.diagnostics(),
      getRoot: (number) => sheet07Production.getRoot(number),
    },
    refreshCampaign: () => {
      refreshCampaignVisualAvailability();
      campaignWorld.refresh();
      rebuildReno();
      rebuildLayout();
      refreshCondition();
    },
    campaignDiagnostics: () => ({
      world: campaignWorld.diagnostics(),
      sheet07: sheet07Production.diagnostics(),
      businessOpen: campaignAllowsBusiness(state),
    }),
    // Every board that says OPEN or CLOSED, and the one fact driving them. A
    // driver can cross this list against the scene graph, which is how an
    // unwired sign is caught rather than assumed absent.
    signDiagnostics: () => openClosedSigns.diagnostics(),
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
    // SET DOWN WHAT YOU ARE HOLDING. Reported 2026-07-29: "Add a button to put a held item
    // down." Before this, a full pair of arms was a dead end — the carton prompt said "put
    // down what you're holding first" and there was no key that did it. A prompt naming an
    // action the player cannot take is the same defect the box-cutter prompt was.
    //
    // Two things can be in your arms and never both (pickUpBox enforces that), so this is
    // one verb with two branches:
    //
    //   a carried CARTON -> the floor, one pace ahead, through the ordinary placement
    //     validator. A refused spot reports the validator's own reason rather than a generic
    //     failure, so "that would go through the wall" reaches the player.
    //   an ARMFUL of goods -> the backroom shelving, via the existing storeInBack path.
    //     Not a new destination and not a deletion: the units stay in inventory and can be
    //     fetched again. There is no floor entity for loose product, so inventing one here
    //     would be a bigger change than the report asks for.
    setDownCarried: (aheadX, aheadZ, ry = 0) => {
      // the carried LEDGER first: it never coexists with a carried box (the
      // pick-up refuses full arms), so this order costs nothing
      if (ledgerBook.isCarried()) {
        const local = W2L(aheadX, aheadZ);
        // inverse of frontDeskPoint: is the drop point ON the desk?
        const dx = local.x - FRONT_DESK_FRAME.x;
        const dz = local.z - FRONT_DESK_FRAME.z;
        const cos = Math.cos(FRONT_DESK_FRAME.ry);
        const sin = Math.sin(FRONT_DESK_FRAME.ry);
        const deskX = dx * cos - dz * sin;
        const deskZ = dx * sin + dz * cos;
        const onDesk = Math.abs(deskX) <= 2.35 && Math.abs(deskZ) <= 0.50;
        // VERIFY2_L: an off-desk drop used to seat at interior y=0.001, which
        // outdoors is FLUSH with the walkway - the closed book vanished into
        // the paving. Ask the ground under the drop point instead.
        const groundLocal = onDesk
          ? COUNTER_TOP
          : (Number.isFinite(groundYAt?.(aheadX, aheadZ))
            ? groundYAt(aheadX, aheadZ) - interior.position.y + 0.004
            : 0.004);
        ledgerBook.placeAt({
          x: local.x,
          z: local.z,
          y: groundLocal,
          ry,
        });
        sfx('boxdown');
        return {
          ok: true,
          kind: 'ledger',
          message: onDesk ? 'Set the club register on the desk.' : 'Set the club register down.',
        };
      }
      const box = carriedBox(state);
      if (box) {
        const local = W2L(aheadX, aheadZ);
        const result = putDownBox(state, box.id, { x: local.x, z: local.z, ry });
        if (result.ok) {
          sfx('boxdown');
          rebuildBoxes();
          return { ok: true, kind: 'carton', message: 'Set the carton down.' };
        }
        return { ok: false, kind: 'carton', reason: result.reason || 'There is no room for it here.' };
      }
      const goods = carriedGoods(state);
      if (!goods) return { ok: false, kind: 'none', reason: 'Your hands are empty.' };
      const stored = storeInBack(state);
      if (!stored.ok) return { ok: false, kind: 'goods', reason: stored.reason || 'Those cannot be put away here.' };
      const sku = SHOP_CATALOG.find((s) => s.id === goods.skuId);
      return {
        ok: true,
        kind: 'goods',
        moved: stored.moved,
        message: `Put ${stored.moved} × ${sku ? sku.name : goods.skuId} on the backroom shelving.`,
      };
    },
    carrySpeedFactor: () => carrySpeedFactor(state),
    // I2 (Goal 23): is the player holding the register? courseScene reads this
    // to refuse WASD -- "while I am holding the book, WASD must not move me.
    // I am reading."
    ledgerCarried: () => !!(ledgerBook && ledgerBook.isCarried && ledgerBook.isCarried()),
    // G2 (Goal 24) — CARRYING IS NOT THE ONLY WAY TO BE HOLDING IT.
    //
    // The movement lock was gated on `ledgerCarried()` alone, and so was the
    // check that certified it: the Goal 23 driver called
    // `ledgerBook.setCarried(true)` and measured 0.0000 forward and 0.0000
    // strafe. Both numbers were honest. They were about the wrong state. A
    // player who presses E to READ the book is OPEN, not carried, and walked
    // away from the desk with the pages in front of them.
    //
    // One accessor for "the book has the player", so the lock and any future
    // check cannot disagree about which state that is again.
    ledgerHasThePlayer: () => !!(ledgerBook
      && ((ledgerBook.isCarried && ledgerBook.isCarried())
        || (ledgerBook.isOpen && ledgerBook.isOpen()))),
    // qaCustomerTrack hands out monotonic ids; see the comment on `id` below.
    // 2.1 QA. Both exist so the walk-up driver reads the SIMULATION rather than
    // inferring from the scene graph. `qaPlayerBlocksCustomers` is the same
    // predicate the three crowd tests ask, so a driver cannot be told one thing
    // while the crowd is told another; `qaCustomerTrack` reports each customer's
    // live position, intended velocity and queue state, which is what makes
    // "walking in place" (intent high, travel zero) expressible at all.
    // QA ONLY: the mesh behind a qaCustomerTrack id, so a driver can pin a body
    // in place and prove its stuck detector can actually see a stall. A detector
    // that reports zero on every build has proved nothing.
    qaCustomerMeshById: (id) => {
      for (const c of customers) if (c && c.mesh && qaTrackId(c) === id) return c.mesh;
      return null;
    },
    qaPickStats: () => ({ ...pickStats }),
    qaPlayerBlocksCustomers: () => playerBlocksCustomers(),
    qaCustomerTrack: () => customers
      .filter((c) => c && c.mesh && c.mesh.visible !== false)
      .map((c, i) => ({
        // A STABLE IDENTITY, STAMPED ONCE. Customers carry no id of their own, so
        // the first version of this fell back to the ARRAY INDEX -- which changes
        // under a walker the moment anyone ahead of them is removed. A tracker
        // keyed on that compares one person's position against another's and
        // reads the difference as travel, so "walking in place" (intent high,
        // travel zero) gets silently reclassified as movement. It biases toward
        // UNDER-counting the fault, which is the safer direction but still wrong.
        id: qaTrackId(c),
        index: i,
        x: +c.mesh.position.x.toFixed(4),
        z: +c.mesh.position.z.toFixed(4),
        vx: +(c.vx || 0).toFixed(4),
        vz: +(c.vz || 0).toFixed(4),
        queued: c.queued === true,
        slot: c.queueSlotHeld ?? null,
        served: c.served === true,
        // WHICH STOP ARE THEY ON? "They never reached the queue" is a symptom
        // with several causes -- no counter stop was planned, they were still
        // browsing, or they walked past it -- and the route index separates them.
        stopIdx: c.stopIdx ?? null,
        stopKind: (c.stops && c.stops[c.stopIdx]) ? c.stops[c.stopIdx].kind : null,
        // How deep inside the nearest customer collider this body is, and how far
        // outside if it is clear. The residual walk-in-place happens with ~1.9 yd
        // of clear space to the nearest neighbour, so it is NOT crowd separation;
        // the remaining candidate is static geometry, and this is what asks it.
        // Positive = penetration depth, negative = clearance.
        // Is this body deliberately HOLDING for a fixture stand? A shopper waiting
        // their turn at a shelf stands still with movement intent still set, which
        // my walk-in-place metric would score as the defect -- the same mistake
        // the queue split already corrected one level up. Exposed so the metric
        // can exclude it rather than be quietly wrong about it.
        waitingForStand: c.waitSlot != null || c.waitFixtureId != null,
        fixtureClaim: c.fixtureClaim ?? null,
        linger: Number.isFinite(c.linger) ? +c.linger.toFixed(2) : null,
        colliderPen: (() => {
          if (!c.mesh) return null;
          const x = c.mesh.position.x;
          const z = c.mesh.position.z;
          let best = -Infinity;
          for (const col of custCols) {
            if (col.door) continue;
            // signed distance to the box: >0 inside
            const dx = Math.min(x - col.minX, col.maxX - x);
            const dz = Math.min(z - col.minZ, col.maxZ - z);
            const pen = Math.min(dx, dz);
            if (pen > best) best = pen;
          }
          return Number.isFinite(best) ? +best.toFixed(3) : null;
        })(),
        // Distance to the CURRENT stop. The arrival test is `dist < 0.18`, and
        // "they never arrived" is only meaningful next to how close they got.
        targetDist: (c.stops && c.stops[c.stopIdx] && c.mesh)
          ? +Math.hypot(c.stops[c.stopIdx].x - c.mesh.position.x,
            c.stops[c.stopIdx].z - c.mesh.position.z).toFixed(3)
          : null,
        stopKinds: Array.isArray(c.stops) ? c.stops.map((x) => x && x.kind).join('>') : null,
        cart: Array.isArray(c.cart) ? c.cart.length : null,
      })),
    carryCollisionRadius: () => {
      const box = carriedBox(state);
      if (!box || box.flat) return 0;
      return deliveryBoxCarryCollisionRadius(box);
    },
    isInside, groundYAt, suppressesGroundCoverAt, vacuumAt, vacuumLabelAt,
    doorWorld: doorW,
    mainEntranceDiagnostics: () => doorsApi.mainEntranceDiagnostics?.() ?? null,
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
      // G4.1: the counter bag, forwarded. `ch.register` is a NARROW FACADE, not
      // the register-mode object, so an accessor added there is invisible here -
      // which cost three driver runs and a wrong suspicion that the bag was
      // never built. A probe reported registerKeysMatching /bag/i as [] and
      // accessorType undefined, which is what settled it.
      bagNode: () => (register.bagNode ? register.bagNode() : null),
      checkoutBagOwnershipStatus: () => (register.checkoutBagOwnershipStatus
        ? register.checkoutBagOwnershipStatus() : null),
      // C2 (Goal 19): forwarded the day it was added — the facade's own note
      // above records what an unforwarded accessor costs.
      cardNode: () => (register.cardNode ? register.cardNode() : null),
      // H (Goal 23): forwarded the day it was added. The facade's own note
      // above records what an unforwarded accessor costs.
      repaintBrand: () => (register.repaintBrand ? register.repaintBrand() : false),
      cardBrandCanvas: () => (register.cardBrandCanvas ? register.cardBrandCanvas() : null),
      debugPaymentCardCanvas: (cardId) => (register.debugPaymentCardCanvas
        ? register.debugPaymentCardCanvas(cardId) : null),
      cardOwnedResourceStatus: () => (register.cardOwnedResourceStatus
        ? register.cardOwnedResourceStatus() : null),
      paidBagResourceStatus: () => (register.paidBagResourceStatus
        ? register.paidBagResourceStatus() : null),
      cardTextureCacheStatus: () => (register.cardTextureCacheStatus
        ? register.cardTextureCacheStatus() : null),
      itemMesh: (uid) => (register.itemMesh ? register.itemMesh(uid) : null),
      bagIsAtCounter: () => (register.bagIsAtCounter ? register.bagIsAtCounter() : false),
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
      // The watchdog's own log. Forwarded because a checkout that parks itself
      // in Recovery looks identical from the outside to one that is merely
      // waiting — only this says which.
      checkoutWatchdogDiagnostics: () => register.checkoutWatchdogDiagnostics(),
      debugFailNextBankHelperReturn: () => register.debugFailNextBankHelperReturn?.(),
      debugFailNextPaidCustomerPresentation: () => {
        const transaction = register.getTx();
        const customer = register.getCustomer();
        if (!transaction || !customer || transaction.banked) {
          qaPaidPresentationFault = null;
          return { armed: false, transactionNumber: null, customerId: null };
        }
        qaPaidPresentationFault = {
          transactionNumber: transaction.number,
          customerId: customer.customerId,
        };
        return { armed: true, ...qaPaidPresentationFault };
      },
      debugFailNextPaidCustomerRelease: () => {
        const transaction = register.getTx();
        const customer = register.getCustomer();
        if (!transaction || !customer || transaction.banked) {
          qaPaidReleaseFault = null;
          return { armed: false, transactionNumber: null, customerId: null };
        }
        qaPaidReleaseFault = {
          transactionNumber: transaction.number,
          customerId: customer.customerId,
        };
        return { armed: true, ...qaPaidReleaseFault };
      },
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
      // B2 (Goal 23): WHAT IS ON THE DESK SCREEN RIGHT NOW. A driver that
      // clicks monitorScreenPoint for a row that is not drawn gets null and
      // cannot tell "the row is missing" from "I asked for the wrong id".
      deskHitTargets: () => (register.deskHitTargets ? register.deskHitTargets() : null),
      // B3 (Goal 24): the status line and its instruction, forwarded the day
      // they were needed. `ch.register` is a NARROW FACADE — the note on
      // bagNode above records the three driver runs an unforwarded accessor
      // costs, and a check that cannot read the screen cannot verify the words
      // printed on it.
      // deskAction reports whether the action was DRAWN as well as whether it
      // ran, which is the difference between "the mouse missed" and "the screen
      // never offered it" — two opposite causes with one symptom.
      deskAction: (action) => (register.deskAction ? register.deskAction(action) : null),
      checkoutStatus: () => (register.checkoutStatus ? register.checkoutStatus() : null),
      checkoutInstruction: () => (register.checkoutInstruction ? register.checkoutInstruction() : null),
      cardXScreenPoint: () => register.cardXScreenPoint(),
      presentedCashScreenPoint: () => register.presentedCashScreenPoint(),
      drawerSlotScreenPoint: (denom) => register.drawerSlotScreenPoint(denom),
      // ITEM 12: the offered notes INDIVIDUALLY. presentedCashScreenPoint
      // returns the pile's one generous hit sphere, which is the right target
      // to click and the wrong one to aim a per-note hover test at. This
      // facade is a hand-written whitelist, so a method added to the register
      // is invisible until it is forwarded here — which is exactly how the
      // first run of the note-hover driver reported "0 notes on the desk"
      // when it should have said "the accessor never existed".
      presentedTenderScreenPoints: () => register.presentedTenderScreenPoints(),
      presentedCardScreenPoint: () => register.presentedCardScreenPoint(),
      cardTerminalScreenPoint: () => register.cardTerminalScreenPoint(),
      insertAt: () => register.insertAt(),
      cardKeyScreenPoint: (actionId) => register.cardKeyScreenPoint(actionId),
      debugTerminalXAt: (x, y) => register.debugTerminalXAt(x, y),
      debugWorkingPose: () => register.debugWorkingPose(),
      debugMonitorTabPixels: () => register.debugMonitorTabPixels(),
      debugCardGrabOutline: (on) => register.debugCardGrabOutline(on),
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
    crowdDiagnostics,
    // Every stuck escalation across the session, with positions, targets and the
    // colliders that boxed the walker in. The live-parity day run reads THIS —
    // the same evidence the live game logs — instead of inventing its own.
    navBlockDiagnostics: () => ({
      total: navBlocksTotal,
      recent: navBlockLog.slice(-120),
      // B (Goal 21): how often the look-ahead actually RUNS in the real shop,
      // as opposed to in a test's hand-drawn room. engagedPct near zero means
      // it is shipped disabled and every passing test measured unreached code.
      steer: {
        ...steerStats,
        engagedPct: steerStats.calls
          ? +(100 * steerStats.engaged / steerStats.calls).toFixed(1) : 0,
        steeredPct: steerStats.calls
          ? +(100 * steerStats.steered / steerStats.calls).toFixed(1) : 0,
        travelMean: steerStats.calls
          ? +(steerStats.travelSum / steerStats.calls).toFixed(3) : 0,
        minTravel: STEER_DEFAULTS.minTravel,
      },
      // G2: how near the sliding branch came to firing, and how often it was
      // the only thing that saw a stuck customer
      progressPeakSeconds: +navProgressPeak.toFixed(2),
      slidingRescues: navSlidingRescues,
      slidingThresholdSeconds: NAV_SLIDING_SECONDS,
    }),
    // QA-only: the three things a nav claim needs to be measurable rather than
    // asserted - the path the customers' own grid returns, a floor obstacle
    // dropped where the driver wants one, and the ladder's running tally.
    navBlockReport: () => navBlockLog.slice(),
    // Path between two points the GRID chose, not two a driver guessed. A
    // request that starts or ends inside a collider returns an empty path,
    // which reads to a naive driver as a perfectly straight line - so the
    // endpoints are snapped, and the run itself is discovered by sweeping the
    // sales floor for the longest clear span the grid will actually walk.
    debugCustomerRun: (span = 5.0) => {
      const grid = navFresh();
      const seedW = L2W(COUNTER.registerX, COUNTER.registerZ);
      const anchor = grid.nearestOpenWorld(seedW.x, seedW.z + 3.0, 10);
      if (!anchor) return null;
      const openAt = (x, z) => {
        const p = grid.nearestOpenWorld(x, z, 0.35);
        return p && Math.hypot(p.x - x, p.z - z) < 0.35;
      };
      let a = { x: anchor.x, z: anchor.z };
      let b = { x: anchor.x, z: anchor.z };
      for (let d = 0.25; d <= span; d += 0.25) {
        if (openAt(anchor.x - d, anchor.z)) a = { x: anchor.x - d, z: anchor.z };
        if (openAt(anchor.x + d, anchor.z)) b = { x: anchor.x + d, z: anchor.z };
      }
      const world = grid.path(a.x, a.z, b.x, b.z) || [];
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      const local = (p) => {
        const l = W2L(p.x, p.z);
        return { x: +l.x.toFixed(3), z: +l.z.toFixed(3) };
      };
      return {
        from: { x: +a.x.toFixed(3), z: +a.z.toFixed(3) },
        to: { x: +b.x.toFixed(3), z: +b.z.toFixed(3) },
        midLocal: local(mid),
        length: +Math.hypot(b.x - a.x, b.z - a.z).toFixed(3),
        points: world.map((p) => ({ x: +p.x.toFixed(3), z: +p.z.toFixed(3) })),
      };
    },
    // The path between endpoints the CALLER pins, so a before/after comparison is the
    // same route twice. `debugCustomerRun` re-derives its own span each call, which is
    // right for discovering a clear stretch and wrong for comparing one: dropping a box
    // shrinks the span it can find, so the two probes end up measuring different routes.
    debugPathBetween: (ax, az, bx, bz) => {
      const grid = navFresh();
      const world = grid.path(ax, az, bx, bz) || [];
      // Local coordinates alongside world, because a caller that wants to put something
      // ON this path has to hand `debugDropFloorBox` an interior-local point.
      return {
        from: { x: +ax.toFixed(3), z: +az.toFixed(3) },
        to: { x: +bx.toFixed(3), z: +bz.toFixed(3) },
        points: world.map((p) => ({ x: +p.x.toFixed(3), z: +p.z.toFixed(3) })),
        pointsLocal: world.map((p) => {
          const l = W2L(p.x, p.z);
          return { x: +l.x.toFixed(3), z: +l.z.toFixed(3) };
        }),
      };
    },
    debugDropFloorBox: (lx, lz, size = 0.7) => {
      const col = addCol(colBoxAt(lx, lz, size, size));
      debugFloorBoxCols.push(col);
      return { x: +lx.toFixed(3), z: +lz.toFixed(3), half: size / 2 };
    },
    debugClearFloorBoxes: () => {
      for (const col of debugFloorBoxCols) removeCol(col);
      debugFloorBoxCols.length = 0;
      return true;
    },
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
    // GOAL 25 LEGIBILITY — WHY THE TILL LOOKS EMPTY WHILE THE SHOP IS FULL.
    //
    // The Phase 1 stranger found this and the owner named it as one of the two
    // reasons the sale looked broken to him: the head of the line is DESK
    // business — a walk-in asking for a tee time, or a booking checking in.
    // Nobody behind them advances until the player serves them at the desk, so a
    // shop with four people in it shows an untouched counter and a queue that
    // never moves. The game knew; nothing on screen said so.
    //
    // The predicate lives HERE, next to the router that owns it, rather than
    // being re-derived from `customerType` in main.js. A HUD line that guessed
    // the rule would go wrong in exactly the case the rule was written for —
    // that is FOUND_FALSE's "right object, wrong variable" with a longer fuse.
    //
    // Returns null when there is nothing to say, so the caller has no rule of
    // its own to get wrong.
    // 3.3 (Goal 25) — THE FACADE FORWARDS, and this is where the trap is.
    //
    // ch is a NARROW facade: an accessor added to ledgerBook.js is invisible to
    // courseScene and to every driver until it is named here. That has already
    // cost this project a debugging session — a working implementation reported
    // as NOT BUILT because the only thing missing was a line in this object.
    // Both halves go in together: the per-frame setter and the read-back the
    // 3.3 check asks for.
    ledgerProp: () => ledgerProp,
    setLedgerAimed: (on) => ledgerBook.setAimed?.(on),
    debugLedgerOutline: () => ledgerBook.debugOutline?.() ?? null,
    deskHoldup: () => {
      const head = counterQueue[0];
      if (!head) return null;
      // already at the till: the player is serving them, the line is moving
      if (register.getCustomer && register.getCustomer() === head) return null;
      if (!openDeskCustomer(head) && !deskActionableWalkIn(head)) return null;
      return {
        name: head.fullName || head.name || 'The customer',
        // everyone else in the line, whatever they came for
        behind: Math.max(0, counterQueue.length - 1),
        kind: head.reservationId != null ? 'check-in' : 'tee time',
      };
    },
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
    // The desk-errand sibling of sendToCounter(): a walk-in golfer standing at
    // the service queue asking for a tee time. Same contract — it skips the
    // floor walk, not the accounting; the ask, the queue join, and the booking
    // all run the production path. options.requestedTeeMinute pins the ask
    // for deterministic tests; omitted, the customer draws one at spawn.
    sendWalkInToDesk(options = {}) {
      // A staged desk errand is PURE by default: a rolled combined-visit
      // retail plan would send the walker to the shelves instead of the
      // queue, and every L1 driver depends on them arriving at the desk.
      // Pass skipRetailPlan:false to stage the COMBINED case instead, which
      // needs the natural route left alone so the shop half is actually
      // walked before the counter.
      const pureDeskErrand = options.skipRetailPlan !== false;
      const c = spawnCustomer(false, null, {
        forceWalkIn: true,
        skipRetailPlan: pureDeskErrand,
        requestedTeeMinute: options.requestedTeeMinute,
      });
      if (!c) return null;
      c.scriptedVisit = true;
      if (!pureDeskErrand) {
        c.entered = true;
        return c;
      }
      const q = queueSlotW(0);
      c.mesh.position.set(q.x, c.mesh.position.y, q.z);
      const regW = L2W(COUNTER.registerX, COUNTER.registerZ);
      c.stops = [
        { kind: 'counter', x: q.x, z: q.z, faceX: regW.x, faceZ: regW.z },
        { kind: 'exit', x: doorW.x, z: doorW.z + 2.6 },
        { kind: 'gone', x: doorW.x, z: doorW.z + 6 },
      ];
      c.stopIdx = 0;
      c.entered = true;
      return c;
    },
    // read-only QA: the staged-customer HANDLE (sendToCounter returns the
    // display name; drivers need the live entity to watch phases/poses)
    customerByName: (n) => customers.find((c) => c.name === n || c.fullName === n) || null,
    // C3 (Goal 24): where the head of the line physically stands, in world
    // space. A driver measuring "did they hand goods over before their turn"
    // needs the floor position, not the queue array index — the two disagree for
    // several seconds every time the line advances, which is the whole bug.
    queueHeadSlot: () => {
      const s = queueSlotW(0);
      return { x: s.x, z: s.z };
    },
    // P1 (Goal 25 playtest) — WHERE THE LINE STANDS, AND WHO IS IN FRONT OF WHOM.
    //
    // Reports through the SAME functions the placement gate uses
    // (customerIsAtTheDesk, and the corridor geometry deskApproachIsClear
    // measures), so a driver cannot certify a rule its own copy invented. The
    // body gap is recomputed here from live world positions rather than read
    // back as a boolean, because "did it refuse" and "was anyone actually in the
    // way" are different questions and a probe that can only see the first
    // cannot tell a working gate from an empty shop.
    queueSlotForIndex: (i) => {
      const s = queueSlotW(Math.max(0, Math.floor(i)));
      return { x: s.x, z: s.z };
    },
    stagingPointWorld: () => {
      const p = L2W(REGISTER.staging.x, REGISTER.staging.z);
      return { x: p.x, z: p.z };
    },
    debugQueueCorridors: () => {
      const staging = L2W(REGISTER.staging.x, REGISTER.staging.z);
      return counterQueue.map((c, index) => {
        if (!c?.mesh) return { index, name: c?.name ?? null, mesh: false };
        const ax = c.mesh.position.x;
        const az = c.mesh.position.z;
        const vx = staging.x - ax;
        const vz = staging.z - az;
        const len2 = (vx * vx) + (vz * vz);
        let minGap = Infinity;
        let blockedBy = null;
        if (len2 >= 1e-4) {
          for (const other of customers) {
            if (other === c || !other.mesh) continue;
            const t = (((other.mesh.position.x - ax) * vx) + ((other.mesh.position.z - az) * vz)) / len2;
            if (t <= 0.15 || t >= 1) continue;
            const cx = ax + (vx * t);
            const cz = az + (vz * t);
            const gap = Math.hypot(other.mesh.position.x - cx, other.mesh.position.z - cz);
            if (gap < minGap) { minGap = gap; blockedBy = other.name || null; }
          }
        }
        return {
          index,
          name: c.name || null,
          atDesk: customerIsAtTheDesk(c),
          awaitingCheckout: !!c.awaitingCheckout,
          hasCart: !!(c.cart && c.cart.length),
          distanceToHeadSlotYd: +Math.hypot(
            ax - queueSlotW(0).x, az - queueSlotW(0).z,
          ).toFixed(3),
          corridorMinBodyGapYd: Number.isFinite(minGap) ? +minGap.toFixed(3) : null,
          blockedBy,
        };
      });
    },
    // B5 (Goal 24) — CLEAR THE PERSON AT THE COUNTER.
    //
    // "When the game wedges or I do not want them there, I need a way to clear
    // them." This is deliberately routed through removeCustomer, which is the
    // single funnel every shopper already leaves through: it voids the live
    // transaction so the register cannot bank a sale for goods that have gone
    // back on the shelf, returns the stock, releases fixture claims, drops them
    // from the queue and lets the register go. Anything hand-rolled here would
    // be the money-out-of-nothing bug that comment was written about.
    //
    // Reported honestly: nothing to clear returns null rather than pretending.
    dismissCounterCustomer() {
      const atTill = register.getCustomer();
      const target = atTill || counterQueue[0]
        || customers.find((c) => c.awaitingCheckout || (c.cart && c.cart.length));
      if (!target) return null;
      const name = target.fullName || target.name || null;
      const index = customers.indexOf(target);
      if (index < 0) return null;
      // removeCustomer SPLICES the array itself (last line of it). Splicing
      // again here removed an innocent bystander standing behind them.
      removeCustomer(index);
      return name;
    },
    sendToCounter(skuIds, payMethod = null) {
      const c = spawnCustomer(false);
      if (!c) return null;
      // Placed on purpose, so the closed-sign sweep leaves them alone. Without
      // this a staged shopper is evicted before reaching the till whenever the
      // shop is shut — which is every fresh profile, since a new day opens
      // CLOSED and a harness has no reason to know it must flip the sign.
      c.scriptedVisit = true;
      // An explicit method is the scripted/QA override; otherwise the customer
      // keeps the balanced-bag preference they drew at spawn.
      if (payMethod === 'cash' || payMethod === 'card') c.payMethod = payMethod;
      for (const skuId of skuIds) {
        const picked = pickFromShelf(state, skuId);
        if (!picked.ok) continue;
        const uid = picked.uid;
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
      const regW = L2W(REGISTER.scanner.x, REGISTER.scanner.z);
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
    setTimeMood: (minuteOfDay) => {
      shell.lighting.setTimeMood(minuteOfDay);
      premiumCountryClub.setTimeMood(minuteOfDay);
    },
    pineHillsInterior: Object.freeze({
      ready: pineHillsInterior.ready,
      diagnostics: () => pineHillsInterior.diagnostics(),
      refresh: () => pineHillsInterior.refresh(),
      getRoot: (key) => pineHillsInterior.getRoot(key),
    }),
    refreshShopProgression,
    shopProgressionDiagnostics: () => shopProgressionVisuals.diagnostics(),
    // build mode: the shop is the player's to arrange
    build: builder,
    furnitureDiagnostics: () => ({
      placement: builder.diagnostics(),
      visuals: placeableVisuals?.diagnostics?.() || null,
      layoutRevision: ensureLayout(state).revision,
    }),
    ceilingLightingDiagnostics: () => ({
      circuitPowered: shell.lighting.isCeilingCircuitPowered(),
      campaignRequiresRepair: state.campaign?.enabled === true,
      repairComplete: repairComplete(state, 'ceiling'),
      authoredPanelRenderBudget: shell.lighting.panelRenderBudget(),
      physicalLightBudget: ceilingLightBudgetState,
    }),
    propertyFurnitureDiagnostics: () => decorObjs.map((entry) => ({
      placementId: entry.placementId,
      skuId: entry.skuId,
      visible: entry.group.visible,
      loaded: entry.group.userData.loaded === true,
      loadError: entry.group.userData.loadError || null,
      propActive: entry.propActive,
      lodLevels: entry.group.userData.authoredLod?.levels?.map((level) => ({
        name: level.object.name,
        distance: level.distance,
        visible: level.object.visible,
      })) || [],
      props: entry.props.map((prop) => ({
        component: prop.furnitureComponent || null,
        lightControl: prop.lightControl || null,
        retailShelfStock: prop.retailShelfStock || null,
        retailShelfStorage: prop.retailShelfStorage || null,
        storageZone: prop.storageZone || null,
        registered: registeredProps.includes(prop),
        x: prop.x,
        z: prop.z,
        aimY: prop.aimY ?? null,
      })),
      components: (entry.group.userData.interactiveComponents || []).map((component) => ({
        name: component.name,
        type: component.type,
        open: component.isOpen(),
        progress: component.progress,
      })),
      lighting: entry.group.userData.ceilingLightController?.diagnostics?.() || null,
      ceilingInstallation: entry.group.userData.ceilingInstallation || [],
      lod: entry.group.userData.authoredLod ? {
        distances: entry.group.userData.authoredLod.userData.runtimeDistances || [],
        levels: entry.group.userData.authoredLod.levels?.length || 0,
      } : null,
    })),
    // the pressure washer: aim at the building, pull the trigger, watch the wall come back
    washAim: (origin, dir) => washing.aim(origin, dir),
    washApply: (hit, mode, radius, power, dt, now) => {
      const r = washing.apply(hit, mode, radius, power, dt, now);
      if (r.cleaned > 0) washing.announceIfDone(hit.id);
      return r;
    },
    // assets 71-100 dressing
    props71to100: {
      ready: props61to100.ready,
      diagnostics: () => props61to100.diagnostics(),
    },
    assets51to100Runtime: {
      ready: props61to100.ready,
      diagnostics: () => props61to100.diagnostics(),
      getRoot: (number, fixtureId = null) => props61to100.getRoot(number, fixtureId),
      interactionTargets: () => props61to100.interactionTargets(),
      fittingRoom: () => ({
        structuralColliders: fittingRoomColliders.length,
        structuralCollidersActive: fittingStructuralCollidersActive,
        curtainColliderActive: fittingCurtainColliderActive,
        curtainOpen: state.shop?.assetRuntime?.asset_063?.open === true,
      }),
    },
    washJet: (from, to, on, dt) => washing.setJet(from, to, on, dt),
    washTick: (dt) => washing.tick(dt),
    // the cleaning kit: one entry point, dispatched on the tool's declared class. Callers pass
    // the tool's own socket point in world space — never a guess taken off the camera.
    cleanWithTool,
    stopCleaningEffects: () => {
      moteFade = 0;
      motes.visible = false;
    },
    cleaningAim,
    cleaningSurfaceAt: (wx, wz) => {
      const local = W2L(wx, wz);
      return cleaningSurfaceAt(local.x, local.z);
    },
    cleaningStatus: () => cleaningStatus(state),
    cleaningEffectsDiagnostics: () => ({
      motesVisible: motes.visible,
      wetVisible: wetPlane.visible,
      washerJetVisible: washing.jet.visible,
      washerMistVisible: washing.mist.visible,
      washerWet: washing.wetnessDiagnostics(),
    }),
    // DIRT SENSE. `setDirtReveal(alpha, columns)` lights every remaining
    // cluster through geometry; `columns` is the overview camera's variant.
    // `nearestDirt` answers the reticle: is the thing under the crosshair
    // actually cleanable?
    setDirtReveal,
    nearestDirt: (wx, wz, radius = 0.75) => {
      const local = W2L(wx, wz);
      if (!local) return null;
      return nearestDebrisLocal(local.x, local.z, radius);
    },
    dirtSenseDiagnostics: () => ({
      alpha: +senseAlpha.toFixed(3),
      columns: senseColumns,
      markers: senseMesh.count,
      visible: senseMesh.visible,
      drawsThroughGeometry: senseMat.depthTest === false,
      clusters: debrisState(state).filter((d) => d && d.a > 0.001).length,
      totalDebris: +totalDebris(state).toFixed(3),
      // D3: which medium each marker belongs to, and how many were withheld
      // because the held tool cannot shift them. `tool: null` means no cleaning
      // tool is out and everything is shown.
      tool: senseTool,
      media: senseTool ? toolMedia(senseTool) : [MEDIUM.DEBRIS, MEDIUM.GRIME],
      debrisMarkers: senseTally.debris,
      grimeMarkers: senseTally.grime,
      hiddenByTool: senseTally.hiddenByTool,
      perInstanceColour: !!senseMesh.instanceColor,
      // J1: on foot the reveal draws the OBJECTS — pile ghosts and cell-fitted
      // stain quads — and the sphere pillars only exist in columns mode.
      presentation: senseColumns ? 'columns' : 'objects',
      ghostGrit: senseGhostGrit.count,
      ghostLitter: senseGhostLitter.count,
      grimeQuads: senseGrimeQuad.count,
      // Q1: how many CELLS carry grime vs how many speckles were drawn for
      // them. A blob-style reveal draws one per cell; the specific-mess
      // reveal draws several, each far smaller than a cell.
      grimeCellsDirty: senseTally.grimeCellsDirty ?? 0,
      grimeCellsShown: senseTally.grime,
      grimeCellSize: +Math.min(RENO.room.w / RENO.grid.w, RENO.room.d / RENO.grid.h).toFixed(3),
    }),
    cleaningLabel: (toolId) => {
      const status = cleaningStatus(state);
      if (!status || !CLEANING_TOOLS[toolId]) return null;
      if (toolId === 'mop') {
        return status.mop.wet
          ? `Mop wet ${Math.round((status.mop.charge / status.mop.capacity) * 100)}% · hard floors only`
          : 'Mop dry · use the bucket in the cleaning bay';
      }
      if (toolId === 'dustpan') return `Dustpan ${status.pan.load.toFixed(1)}/${status.pan.capacity}`;
      if (toolId === 'trashbag') {
        return `Trash bag ${status.bag.load.toFixed(1)}/${status.bag.capacity}${status.bag.tied ? ' · tied' : ''}`;
      }
      if (toolId === 'cloth') return 'Microfibre cloth · spray first, then wipe';
      if (toolId === 'sponge') return 'Scouring sponge · stubborn grime takes repeated passes';
      return CLEANING_TOOLS[toolId].label;
    },
    debrisTotal: () => totalDebris(state),
    debrisCount: () => debrisState(state).length,
    panLoad: () => cleaningStatus(state)?.pan.load || 0,
    bagLoad: () => cleaningStatus(state)?.bag.load || 0,
    emptyPan: () => emptyPanIntoBag(state).moved,
    disposeBag: () => disposeTiedBag(state),
    // `customers` is NOT re-exported here. It was, and being the LATER key in
    // the same object literal it silently overwrote the accessor 350 lines
    // above, so `clubhouse().customers()` threw "not a function" for every
    // driver that used the documented form — which is why item 14 could not be
    // confirmed last session. One name, one meaning: customers() is a getter.
    doors, // QA access
    // C6 acceptance: "N of M visits contained both a purchase and a booking".
    // A visit ends by leaving the customers array, so the answer has to be
    // accumulated as it happens rather than counted at the end.
    visitTally: () => ({ ...visitTally }),
    // The desk bridge, read-only for QA. simplifiedRegisterMode reaches it
    // through B; an acceptance run that has to PLAY the desk (a check-in is a
    // player action) had no way in at all.
    frontDeskBridge: () => B.frontDeskReservations || null,
    // L3: the club register on the desk - main.js opens it (enterLedger)
    ledgerBook,
    // A2: which building this is, and every building this session has built
    // before it. One entry means one clubhouse was ever drawn.
    presentation: requestedClubhousePresentation,
    buildLog: () => CLUBHOUSE_BUILD_LOG.map((entry) => ({ ...entry })),
    collisionDiagnostics: () => Object.freeze(registeredCols.map((collider, index) => {
      const primitiveMetadata = {};
      for (const [key, value] of Object.entries(collider)) {
        if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
          primitiveMetadata[key] = value;
        }
      }
      return Object.freeze({ index, ...primitiveMetadata });
    })),
    // Shed presentation self-diagnosis — the shed-shell probe asserts on this.
    shedDiagnostics: () => {
      let visibleInteriorMeshes = 0;
      interior.traverse((object) => {
        if (!(object.isMesh || object.isInstancedMesh)) return;
        let visible = object.visible;
        let parent = object.parent;
        while (visible && parent) { visible = parent.visible; parent = parent.parent; }
        if (visible) visibleInteriorMeshes++;
      });
      const detail = shedPresentation && detailInterior?.diagnostics ? detailInterior.diagnostics() : {};
      return {
        variant: requestedClubhousePresentation,
        shed: shedPresentation,
        suppressedNodes: shedSuppressedNodes,
        visibleInteriorMeshes,
        colliderCount: registeredCols.length,
        shellContract: {
          windowDefs: shell.windowDefs?.length ?? 0,
          lighting: Object.keys(shell.lighting || {}),
        },
        // Shed content self-report (Task 5): the eleven targets, two window
        // films (one per shed pane), two service stations, seven furniture groups.
        targets: detail.targets ?? 0,
        films: detail.films ?? 0, // single source: the interior's own window-film count (was a parallel shell.windowDefs read)
        stations: detail.stations ?? 0,
        furniture: detail.furniture ?? 0,
        introShown: detail.introShown ?? false,
        grimePlane: shedPresentation ? !!dirt.grimePlane : false,
        doorMode: shedPresentation ? 'dormant' : 'live',
      };
    },
    // What the floor is aiming for, and why. Read-only; the arrival loop owns
    // the number and this only reports it, so a driver can measure concurrency
    // against the inputs that set it rather than inferring both from a count.
    footfallDiagnostics: () => ({
      target: footfallTarget,
      solvedAtMinute: footfallTargetMinute,
      drive: +shopFootfallDrive(state).toFixed(4),
      capacity: shopCustomerCapacity(state),
      onFloor: customers.length,
    }),
    navPerformanceDiagnostics,
    debugSpawn: spawnCustomer, // QA: force a walk-in
    setOrganicWalkins: (on) => { organicWalkins = !!on; }, // QA: silence random walk-ins for a scripted run
    // SIM-TIME-001: the game-speed multiplier, pushed in from the frame loop.
    // The clubhouse cannot read it — it is handed raw wall dt — and that is
    // exactly why every NPC quantity used to be wall-bound.
    setSimSpeed,
    simTimeDiagnostics,
    // QA-only: pin the combined-visit roll so a driver can observe the
    // combined case and the desk-only case deliberately instead of waiting on
    // chance. Never called by the game.
    setCombinedVisitChance: (value) => {
      COMBINED_VISIT_CHANCE = Math.max(0, Math.min(1, Number(value) || 0));
      return COMBINED_VISIT_CHANCE;
    },
    clearWalkins: () => { // QA: empty the floor (returns every held cart to the shelf) so a scripted run starts clean
      for (let i = customers.length - 1; i >= 0; i--) removeCustomer(i);
    },
    dispose,
  };
}

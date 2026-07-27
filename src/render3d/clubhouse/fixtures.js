// CLUBHOUSE RETAIL FIXTURES — the millwork: club-wall bays, retail wall units,
// nesting tables, apparel rail, hat tree, bag platforms, the lit shoe wall,
// the feature pedestal, the checkout island + back-counter, the furnished
// lounge, and the stockroom's working dressing. Walnut carcasses, beveled
// edges, brass pulls, cream category signs, warm under-shelf light strips —
// the reference language (Designs/RefrenceImages 1, 4-9).
//
// CONTRACT: merch placement (clubhouse.js rebuildStock) lands items on these
// exact surfaces — shelf boards y [0.5, 1.05, 1.6], rack base y≈0.14 with the
// back at z −0.4, table top ≈1.0 with the rail at (z −0.62, y 1.68), shoe
// boards y [0.35, 0.85, 1.35], feature top y 0.94, backshelf boards
// y [0.4, 1.05, 1.7]. Change those here and the stock floats or sinks.

import * as THREE from 'three';
import {
  FIXTURES, COUNTER, LOUNGE, STOCKROOM, INTERIOR, SHELL, LOGO_RUG, REGISTER,
  COUNTER_TOP, FRONT_DESK_ASSETS, FRONT_DESK_COLLIDERS, FRONT_DESK_FRAME,
  METERS_PER_YARD, fixtureRect,
} from '../../data/shopLayout.js';
import { priceFor, restockShelfFromBackroom } from '../../sim/shop.js';
import { skuById } from '../../data/shopItems.js';
import { capacityOf } from '../../data/fixtureSlots.js';
import { activeFixtures, placedFixtures } from '../../sim/layout.js';
import { tutorialFlag } from '../../sim/tutorial.js';
import {
  OPENING_DRINKS_COOLER_DOOR,
  OPENING_DRINKS_COOLER_FIXTURE_ID,
  openingDrinksCoolerSnapshot,
  toggleOpeningDrinksCoolerDoor,
} from '../../sim/openingDrinksCooler.js';
import { roundedBox, makeSignTexture, makeRugTexture } from './materials.js';
import {
  collectMaterialResources, collectRenderableResources, disposeRenderableResources,
  mergeRenderableResources,
} from './resourceLifecycle.js';
import { DELIVERY_EQUIPMENT_DEFAULT_LAYOUT } from './deliveryEquipment.js';
import { createMovableFixtureCoreBatcher } from './fixtureCoreBatching.js';
import { batchRigidVisualsByPbrResponse } from './rigidVisualBatch.js';
import { shopTierIndex } from '../../sim/shopProgression.js';

// The payment terminal remains in its authored hierarchy because register mode
// raycasts that exact root for the player's activation click. Other rigid
// checkout devices can still share the low-draw PBR batch; their live screens,
// scanner feedback, sockets, and receipt paper are excluded by material/name.
export const CHECKOUT_RIGID_BATCH_HARDWARE = Object.freeze([
  'pos_monitor',
  'barcode_scanner',
  'receipt_printer',
  'customer_display',
]);

// warm under-shelf light strip (pure emissive — the real lights are the rig's)
function lightStrip(mats, w) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.018, 0.03),
    new THREE.MeshStandardMaterial({ color: 0xfff3d9, emissive: 0xffe2b0, emissiveIntensity: 1.6 }),
  );
}

function categorySign(title, { w = 1.5, h = 0.26, charcoal = false } = {}) {
  const text = title.toUpperCase();
  const fontSize = text.length > 18 ? 30 : text.length > 13 ? 36 : 44;
  const tex = makeSignTexture([title.toUpperCase()], {
    w: 512, h: 128, frame: false,
    field: charcoal ? '#23262b' : '#e6dfcf',
    ink: charcoal ? '#c9a227' : '#1f4a26',
    sizes: [fontSize],
  });
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    // Printed department boards need one stable charcoal field across the
    // three adjacent bays. A basic material keeps point-light angle from
    // turning identical signs into three visibly different greys.
    new THREE.MeshBasicMaterial({ map: tex, color: 0xe8e2d7, toneMapped: true }),
  );
}

function priceRail(f, state, { w = 2.6, h = 0.20 } = {}) {
  const entries = (f.skus || []).map((id) => {
    const sku = skuById(id);
    if (!sku) return null;
    const words = sku.name.split(/\s+/)[0];
    const markup = Number.isFinite(state?.shop?.markup?.[sku.cat])
      ? state.shop.markup[sku.cat]
      : 1;
    return `${words.toUpperCase()}  $${priceFor(sku, markup, null).toFixed(2)}`;
  }).filter(Boolean);
  if (!entries.length) return null;
  const rows = entries.length <= 3
    ? [entries.join('  ·  ')]
    : [entries.slice(0, Math.ceil(entries.length / 2)).join('  ·  '), entries.slice(Math.ceil(entries.length / 2)).join('  ·  ')];
  const tex = makeSignTexture(rows, {
    w: 1024, h: rows.length > 1 ? 160 : 96, frame: false,
    field: '#28382e', ink: '#eee6d7', sizes: rows.map(() => entries.length > 6 ? 23 : 28),
  });
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, color: 0xe8e2d7, toneMapped: true }),
  );
}

export function incompatibleStockingLabel(fixtureTitle, skuName, correctFixtureTitle = null) {
  const destination = correctFixtureTitle || 'its assigned display';
  return `${fixtureTitle} — ${skuName} cannot be stocked here · take it to ${destination}`;
}

function releaseReplacedFixture(root, mats, merch) {
  if (!root) return;
  root.removeFromParent();
  const protectedResources = mergeRenderableResources(
    collectMaterialResources(mats),
    merch?.ownedResources ? merch.ownedResources() : null,
  );
  disposeRenderableResources(collectRenderableResources(root), protectedResources);
}

// Toggle only the colliders authored by one movable fixture. Registration is
// stateful so repeated update/cancel calls cannot duplicate an entry in the
// shared player/customer collider arrays.
export function setTrackedFixtureCollidersActive(
  colliders,
  fixtureId,
  active,
  addCollider,
  removeCollider,
) {
  let changed = 0;
  for (const collider of colliders) {
    if (collider.fixtureLayoutId !== fixtureId) continue;
    if (active && collider.fixtureColliderActive === false) {
      addCollider(collider);
      collider.fixtureColliderActive = true;
      changed++;
    } else if (!active && collider.fixtureColliderActive !== false) {
      removeCollider(collider);
      collider.fixtureColliderActive = false;
      changed++;
    }
  }
  return changed;
}

export function buildFixtures(B) {
  const {
    interior, mats, merch, addCol: rawAddCol, addProp: rawAddProp, removeCol, removeProp,
    colBoxAt, L2W, state, hooks,
  } = B;
  const fixtureCoreBatcher = createMovableFixtureCoreBatcher(merch);

  // Only what the fixture loop lays down is re-layable; the counter, the rug and the lounge are
  // architecture, not furniture the player pushes around.
  let tracking = false;
  let activeFixtureId = null;
  const laidCols = [];
  const laidProps = [];
  const addCol = (c) => {
    if (tracking) {
      c.fixtureLayoutId = activeFixtureId;
      c.fixtureColliderActive = true;
      laidCols.push(c);
    }
    return rawAddCol(c);
  };
  const addProp = (p) => {
    const made = rawAddProp(p);
    if (tracking) laidProps.push(made || p);
    return made;
  };
  const fixtureAnchors = new Map();
  const animatedFixtureControllers = new Map();

  function stopAnimatedFixtureControllers() {
    for (const controller of animatedFixtureControllers.values()) {
      controller.mixer?.stopAllAction?.();
      if (controller.root && controller.mixer?.uncacheRoot) {
        controller.mixer.uncacheRoot(controller.root);
      }
    }
    animatedFixtureControllers.clear();
  }

  function updateOpeningCoolerDoorCollider(controller) {
    const mesh = controller.doorColliderMesh;
    const geometry = mesh?.geometry;
    if (!mesh || !geometry || !controller.doorCollider) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;
    mesh.updateWorldMatrix(true, false);
    controller.worldDoorBounds.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    const { min, max } = controller.worldDoorBounds;
    if (![min.x, min.z, max.x, max.z].every(Number.isFinite)) return;
    controller.doorCollider.minX = min.x;
    controller.doorCollider.maxX = max.x;
    controller.doorCollider.minZ = min.z;
    controller.doorCollider.maxZ = max.z;
  }

  function setOpeningCoolerDoorPose(controller, doorState, instant = false) {
    if (!controller || controller.doorState === doorState && !instant) return;
    controller.doorState = doorState;
    const clipName = OPENING_DRINKS_COOLER_DOOR.clips[
      doorState === 'open' ? 'open' : 'close'
    ];
    const clip = controller.clips.find((candidate) => candidate.name === clipName);
    controller.mixer?.stopAllAction?.();
    if (clip && controller.mixer) {
      const action = controller.mixer.clipAction(clip, controller.root);
      action.reset();
      action.enabled = true;
      action.clampWhenFinished = true;
      action.setLoop(THREE.LoopOnce, 1);
      action.play();
      if (instant) {
        action.time = clip.duration;
        controller.mixer.update(0);
        action.paused = true;
      }
    } else if (controller.doorNode) {
      // A missing clip must never strand an open persisted save in the closed
      // pose.  GLTF converts the authored +Z hinge into Three.js +Y.
      controller.doorNode.rotation.y = THREE.MathUtils.degToRad(
        doorState === 'open' ? OPENING_DRINKS_COOLER_DOOR.openAngleDegrees : 0,
      );
      controller.doorNode.updateMatrixWorld(true);
    }
    updateOpeningCoolerDoorCollider(controller);
  }

  function syncOpeningCoolerController(controller, dt = 0) {
    const snapshot = openingDrinksCoolerSnapshot(state);
    if (!snapshot) return;
    if (controller.doorState !== snapshot.door.state) {
      setOpeningCoolerDoorPose(controller, snapshot.door.state, false);
    }
    if (dt > 0) controller.mixer?.update?.(dt);
    updateOpeningCoolerDoorCollider(controller);
  }

  function updateAnimatedFixtures(dt) {
    for (const controller of animatedFixtureControllers.values()) {
      syncOpeningCoolerController(controller, dt);
    }
  }

  function disposeReplacedFixture(root) {
    releaseReplacedFixture(root, mats, merch);
  }

  function qualifyKitSockets(root, fixtureId, moduleTag) {
    if (!root) return root;
    root.traverse((object) => {
      if (!object.name || !object.name.includes('SLOT_')) return;
      object.name = `${fixtureId}_${moduleTag}_${object.name}`;
    });
    return root;
  }

  function addFixtureCollider(f) {
    const bounds = fixtureRect(f);
    addCol(colBoxAt(
      (bounds.minX + bounds.maxX) / 2,
      (bounds.minZ + bounds.maxZ) / 2,
      bounds.maxX - bounds.minX,
      bounds.maxZ - bounds.minZ,
    ));
    return bounds;
  }

  function shelfLabel(f) {
    const inv = state.shop.inventory;
    const back = f.skus.reduce((a, id) => a + inv[id].back, 0);

    // if you are holding product, this fixture is either where it goes or somewhere it does not —
    // and it says which. This is the physical stocking path (hold [E] to place, tap for one).
    const held = B.carriedGoods && B.carriedGoods();
    if (held) {
      const heldSku = skuById(held.skuId);
      if (f.skus.includes(held.skuId)) {
        const line = inv[held.skuId] || { shelf: 0 };
        return `${f.title} — ${heldSku.name} ${line.shelf}/${capacityOf(held.skuId)} — hold [E] to stock (${held.qty} in hand)`;
      }
      const correctFixture = placedFixtures(state).find((fixture) => fixture.skus.includes(held.skuId));
      return incompatibleStockingLabel(f.title, heldSku.name, correctFixture?.title);
    }

    const facing = f.skus.map((id) => {
      const sku = skuById(id);
      const line = inv[id] || { shelf: 0 };
      return `${sku.name} ${line.shelf}/${capacityOf(id)}`;
    }).join(' · ');
    if (back > 0) return `${f.title} — ${facing} — ${back} in back — [E] restock`;
    return `${f.title} — ${facing} — backroom empty`;
  }

  // stock this fixture from what is in the player's hands: tap = one, hold = a flow
  function stockHere(f, units) {
    const res = B.stockFromHands(f.id, units);
    if (!res.ok) {
      if (res.invalid && hooks.toast) hooks.toast(res.reason, 'warn');
      return;
    }
    if (hooks.sfx) hooks.sfx(res.full ? 'fullShelf' : 'stock');
    if (res.full && hooks.toast) hooks.toast(`The ${f.title.toLowerCase()} display is full.`);
  }

  // the old convenience path: pull already-unpacked stock from the backroom straight to the shelf.
  // Kept for empty hands — it is the "faster stocking" the brief allows once the goods are unboxed.
  function restockAll(f) {
    let moved = 0;
    for (const id of f.skus) {
      const res = restockShelfFromBackroom(state, id);
      if (res.ok) moved += res.moved;
    }
    if (moved > 0) {
      B.rebuildStock();
      if (state.tutorial) tutorialFlag(state, 'shelved');
      if (hooks.toast) hooks.toast(`Restocked ${moved} items on the ${f.title.toLowerCase()}.`);
      if (hooks.sfx) hooks.sfx('stock');
    } else if (hooks.toast) {
      hooks.toast('Nothing in the back for this display.', 'warn');
    }
  }

  const isOpeningCooler = (f) => f.id === OPENING_DRINKS_COOLER_FIXTURE_ID;
  const openingCoolerDoorOpen = () => (
    openingDrinksCoolerSnapshot(state)?.door.state === 'open'
  );

  function openingCoolerLabel(f) {
    const inv = state.shop.inventory;
    const held = B.carriedGoods && B.carriedGoods();
    const open = openingCoolerDoorOpen();
    if (held) {
      const heldSku = skuById(held.skuId);
      if (!f.skus.includes(held.skuId)) {
        const correctFixture = placedFixtures(state)
          .find((fixture) => fixture.skus.includes(held.skuId));
        return incompatibleStockingLabel(f.title, heldSku.name, correctFixture?.title);
      }
      if (!open) return `${f.title} — door closed · [E] open before stocking`;
      const line = inv[held.skuId] || { shelf: 0 };
      return `${f.title} — ${heldSku.name} ${line.shelf}/${capacityOf(held.skuId)} — hold [E] to stock (${held.qty} in hand)`;
    }

    const facing = f.skus.map((id) => {
      const sku = skuById(id);
      const line = inv[id] || { shelf: 0, back: 0 };
      return `${sku.name} ${line.shelf}/${capacityOf(id)}`;
    }).join(' · ');
    const back = f.skus.reduce((sum, id) => sum + (inv[id]?.back || 0), 0);
    if (!open) return `${f.title} — ${facing} — [E] open cooler`;
    if (back > 0) return `${f.title} — ${facing} — [E] close · [X] restock ${back} from back`;
    return `${f.title} — ${facing} — [E] close · backroom empty`;
  }

  function toggleOpeningCooler() {
    const result = toggleOpeningDrinksCoolerDoor(state);
    if (!result.ok) {
      if (hooks.toast) hooks.toast(result.reason || 'The cooler door would not move.', 'warn');
      return result;
    }
    const controller = animatedFixtureControllers.get(OPENING_DRINKS_COOLER_FIXTURE_ID);
    if (controller) setOpeningCoolerDoorPose(controller, result.doorState, false);
    if (result.changed && hooks.sfx) hooks.sfx('thunk');
    return result;
  }

  function fixtureProp(f) {
    if (!f.skus.length) {
      if (f.kind !== 'backshelf') return;
      const wp = L2W(f.x, f.z);
      addProp({
        x: wp.x, z: wp.z, r: 2.15,
        label: () => {
          const box = B.carriedBox && B.carriedBox();
          if (box) return f.id === 'backshelf_n'
            ? 'Carton rack — [E] store this box in a marked slot'
            : null;
          const held = B.carriedGoods && B.carriedGoods();
          if (held) {
            const sku = skuById(held.skuId);
            return `Receiving reserve — [E] store ${held.qty} × ${sku ? sku.name : held.skuId}`;
          }
          return null;
        },
        action: () => {
          if (B.carriedBox && B.carriedBox()) {
            if (B.placeBoxOnReserveRack) B.placeBoxOnReserveRack(f);
          } else if (B.storeCarriedGoods) B.storeCarriedGoods();
        },
      });
      return;
    }
    const wp = L2W(f.x, f.z);
    const openingCooler = isOpeningCooler(f);
    addProp({
      x: wp.x, z: wp.z, r: 1.15,
      label: () => openingCooler ? openingCoolerLabel(f) : shelfLabel(f),
      action: () => {
        const held = B.carriedGoods && B.carriedGoods();
        if (openingCooler && !openingCoolerDoorOpen()) {
          toggleOpeningCooler();
          return;
        }
        if (held) {
          if (f.skus.includes(held.skuId)) stockHere(f, 1); // tap: one at a time
          else {
            const heldSku = skuById(held.skuId);
            const correctFixture = placedFixtures(state)
              .find((fixture) => fixture.skus.includes(held.skuId));
            if (hooks.toast) {
              hooks.toast(
                `${heldSku.name} belongs on ${correctFixture?.title || 'its assigned display'}.`,
                'warn',
              );
            }
          }
        }
        else if (openingCooler) toggleOpeningCooler();
        else restockAll(f);
      },
      // The cooler keeps its physical [E] door verb.  Empty-handed [X]
      // preserves the existing fast backroom-to-shelf restock path while the
      // door is open; inventory still moves only through restockShelfFromBackroom.
      secondaryAction: openingCooler ? () => {
        if (B.carriedGoods && B.carriedGoods()) return;
        if (!openingCoolerDoorOpen()) {
          if (hooks.toast) hooks.toast('Open the cooler before restocking it.', 'warn');
          return;
        }
        restockAll(f);
      } : undefined,
      // hold: stock a flow from the hands. Only when holding something this fixture accepts.
      hold: (dt) => {
        const held = B.carriedGoods && B.carriedGoods();
        if (held && f.skus.includes(held.skuId)
          && (!openingCooler || openingCoolerDoorOpen())) {
          stockRate += dt * 8;                 // eight a second while you hold
          const n = Math.floor(stockRate);
          if (n >= 1) { stockRate -= n; stockHere(f, n); }
        }
      },
    });
  }
  let stockRate = 0;

  // Blender-authored fixture shell. The collider remains data-owned, while the
  // visible object comes from the repeatable fixture pack. Loading is async, so
  // the anchor exists immediately and the model drops into the same transform.
  function assetUnit(f, model, {
    w, d, sign = null, signY = 2.05, signZ = null, signW = 1.5, signH = 0.24,
    charcoal = false, priceY = 0.23, priceZ = null, priceW = null, priceH = null,
  }) {
    const g = new THREE.Group();
    if (merch) merch.onReady(() => {
      const obj = merch.instantiate(model);
      if (obj) g.add(obj);
    });
    if (sign) {
      const board = categorySign(sign, { w: signW, h: signH, charcoal });
      board.position.set(0, signY, signZ == null ? d / 2 + 0.015 : signZ);
      g.add(board);
    }
    const prices = priceRail(f, state, {
      w: priceW || Math.max(0.68, w * 0.82),
      h: priceH || (f.skus.length > 3 ? 0.16 : 0.13),
    });
    if (prices) {
      prices.position.set(0, priceY, priceZ == null ? d / 2 + 0.02 : priceZ);
      g.add(prices);
    }
    addFixtureCollider(f);
    return g;
  }

  // ------------------------------------------------------------ wall unit ---
  // Sheet-03 modules replace the millwork the moment the kit loads: the ball
  // wall gets three ball_shelf modules (one per line), the accessory runs get
  // three accessory_slatwall modules each. The legacy carcass stands in
  // until then so the wall is never bare.
  function shelfUnit(f) {
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    // carcass: sides, plinth, crown, back panel
    for (const sx of [-1.5, 1.5]) {
      const side = new THREE.Mesh(roundedBox(0.08, 2.3, 0.56, 0.02), mats.walnut);
      side.position.set(sx, 1.15, -0.02);
      side.castShadow = true;
      legacy.add(side);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.25, 0.05), mats.walnutDark);
    back.position.set(0, 1.15, -0.24);
    back.receiveShadow = true;
    legacy.add(back);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.06, 0.16, 0.6), mats.walnutDark);
    plinth.position.set(0, 0.08, -0.01);
    legacy.add(plinth);
    const crown = new THREE.Mesh(roundedBox(3.22, 0.14, 0.66, 0.03), mats.walnut);
    crown.position.set(0, 2.34, -0.01);
    crown.castShadow = true;
    legacy.add(crown);
    for (const y of [0.5, 1.05, 1.6]) {
      const board = new THREE.Mesh(roundedBox(2.94, 0.05, 0.48, 0.015), mats.walnut);
      board.position.set(0, y, 0.02);
      board.castShadow = true;
      board.receiveShadow = true;
      legacy.add(board);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(2.94, 0.022, 0.012), mats.brass);
      edge.position.set(0, y + 0.012, 0.265);
      legacy.add(edge);
      const strip = lightStrip(mats, 2.8);
      strip.position.set(0, y - 0.032, 0.2);
      legacy.add(strip);
    }
    const legacySign = categorySign(f.title);
    legacySign.position.set(0, 2.05, 0.255);
    legacy.add(legacySign);
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const kitName = f.id === 'shelf_balls' ? 'ball_shelf' : 'accessory_slatwall';
      const core = fixtureCoreBatcher.mount(
        g,
        [-1.0, 0.0, 1.0].map((x) => ({ model: kitName, position: [x, 0, 0] })),
        { name: `${f.id}FixtureCore` },
      );
      if (!core) return;
      core.structure.children.forEach((module, index) => {
        qualifyKitSockets(module, f.id, ['L', 'C', 'R'][index]);
      });
      disposeReplacedFixture(legacy);
    });
    addFixtureCollider(f);
    return g;
  }

  // ----------------------------------------------------------- club bay -----
  // Sheet-03 floor racks: two club_rack modules for the driver and iron runs,
  // two putter_rack groove modules for the putter studio. The old wall bay
  // stands in until the kit arrives.
  function rackUnit(f) {
    return assetUnit(f, 'club_wall_bay', {
      w: 3.0, d: 0.9, sign: f.title, signY: 2.27, signZ: 0.36,
      signW: 1.55, signH: 0.20, charcoal: true, priceW: 2.30, priceH: 0.14,
    });
    /* istanbul ignore next -- procedural predecessor retained as a load-bearing design reference */
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    // tall framed back
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.9, 2.35, 0.06), mats.walnutDark);
    back.position.set(0, 1.2, -0.42);
    back.receiveShadow = true;
    legacy.add(back);
    for (const sx of [-1.44, 1.44]) {
      const stile = new THREE.Mesh(roundedBox(0.1, 2.42, 0.16, 0.02), mats.walnut);
      stile.position.set(sx, 1.21, -0.38);
      stile.castShadow = true;
      legacy.add(stile);
    }
    const header = new THREE.Mesh(roundedBox(2.98, 0.34, 0.2, 0.02), mats.walnut);
    header.position.set(0, 2.28, -0.36);
    header.castShadow = true;
    legacy.add(header);
    const legacySign = categorySign(f.title, { w: 1.9, h: 0.3, charcoal: true });
    legacySign.position.set(0, 2.28, -0.25);
    legacy.add(legacySign);
    const strip = lightStrip(mats, 2.7);
    strip.position.set(0, 2.08, -0.3);
    legacy.add(strip);
    // base cabinet: the stand the clubs lean from, drawer fronts + brass pulls
    const base = new THREE.Mesh(roundedBox(2.88, 0.15, 0.9, 0.02), mats.walnut);
    base.position.set(0, 0.075, -0.05);
    base.castShadow = true;
    legacy.add(base);
    for (let i = 0; i < 3; i++) {
      const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.09, 0.03), mats.walnutDark);
      drawer.position.set(-0.94 + i * 0.94, 0.075, 0.41);
      legacy.add(drawer);
      const pull = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.02), mats.brass);
      pull.position.set(-0.94 + i * 0.94, 0.075, 0.435);
      legacy.add(pull);
    }
    // shaft cradle rails with brass clips
    for (const y of [0.62, 1.32]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.05, 0.05), mats.walnut);
      rail.position.set(0, y, -0.3);
      legacy.add(rail);
      for (let i = 0; i < 8; i++) {
        const clip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.04), mats.brass);
        clip.position.set(-1.22 + i * 0.35, y, -0.27);
        legacy.add(clip);
      }
    }
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const putters = f.id === 'rack_putters';
      const spots = putters ? [-0.5, 0.5] : [-0.6, 0.6];
      const core = fixtureCoreBatcher.mount(
        g,
        spots.map((x) => ({
          model: putters ? 'putter_rack' : 'club_rack',
          position: [x, 0, 0],
        })),
        { name: `${f.id}FixtureCore` },
      );
      if (!core) return;
      core.structure.children.forEach((module, index) => {
        qualifyKitSockets(module, f.id, index === 0 ? 'L' : 'R');
      });
      disposeReplacedFixture(legacy);
    });
    addFixtureCollider(f);
    return g;
  }

  // ------------------------------------------------------- apparel table ----
  // The Sheet-04 folded-apparel table (1.60 x 0.90 walnut top on a steel
  // frame) replaces the old nesting tables + rear hang rail. Both polo lanes
  // fold onto the SAME top — twelve stack poses per lane, see
  // fixtureSlots.js tableApparel. The old millwork stands in until the kit
  // loads.
  function tableUnit(f) {
    return assetUnit(f, 'feature_table', {
      w: 2.4, d: 1.44, priceY: 0.65, priceZ: 0.57, priceW: 1.55, priceH: 0.14,
    });
    /* istanbul ignore next -- procedural predecessor retained as a surface-height reference */
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    // Match the authored apparel_table contract exactly while the GLB warms:
    // 1.60 x 0.90 m, with the usable top plane at y=0.801 m.
    const top = new THREE.Mesh(roundedBox(1.6, 0.07, 0.9, 0.025), mats.walnut);
    top.position.y = 0.766;
    top.castShadow = true;
    top.receiveShadow = true;
    legacy.add(top);
    const apron = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.08, 0.76), mats.walnutDark);
    apron.position.y = 0.70;
    legacy.add(apron);
    for (const [lx, lz] of [[-0.68, -0.34], [0.68, -0.34], [-0.68, 0.34], [0.68, 0.34]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.70, 8), mats.walnut);
      leg.position.set(lx, 0.35, lz);
      leg.castShadow = true;
      legacy.add(leg);
    }
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const core = fixtureCoreBatcher.mount(
        g,
        [{ model: 'apparel_table' }],
        { name: `${f.id}FixtureCore` },
      );
      if (!core) return;
      disposeReplacedFixture(legacy);
    });
    addFixtureCollider(f);
    return g;
  }

  // -------------------------------------------------- apparel wall fixture ----
  // Sheet-02 Asset 20 is one 1.20 x 0.45 m wall, not a duplicated rail run.
  // The temporary form shares the authored socket surfaces and envelope, so
  // async replacement cannot make stock jump or leave an oversized blocker.
  function railUnit(f) {
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    for (const rx of [-0.572, 0.572]) {
      const upright = new THREE.Mesh(roundedBox(0.055, 2.18, 0.055, 0.004), mats.iron);
      upright.position.set(rx, 1.09, -0.177);
      upright.castShadow = true;
      legacy.add(upright);
      const foot = new THREE.Mesh(roundedBox(0.055, 0.045, 0.395, 0.004), mats.iron);
      foot.position.set(rx, 0.0225, 0);
      legacy.add(foot);
    }
    const back = new THREE.Mesh(roundedBox(1.10, 1.90, 0.018, 0.004), mats.walnut);
    back.position.set(0, 1.05, -0.12);
    back.receiveShadow = true;
    legacy.add(back);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 1.06, 14), mats.brass);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 1.68, 0);
    legacy.add(bar);
    const signBacker = new THREE.Mesh(roundedBox(1.20, 0.18, 0.16, 0.006), mats.iron);
    signBacker.position.set(0, 2.11, -0.095);
    legacy.add(signBacker);
    const signBoard = categorySign('APPAREL', { w: 1.02, h: 0.155, charcoal: true });
    signBoard.position.set(0, 2.11, -0.012);
    legacy.add(signBoard);
    for (const y of [0.315, 0.615]) {
      const shelf = new THREE.Mesh(roundedBox(1.12, 0.03, 0.40, 0.006), mats.walnut);
      shelf.position.set(0, y, 0);
      shelf.receiveShadow = true;
      legacy.add(shelf);
    }
    for (const rx of [-0.55, 0.55]) {
      const side = new THREE.Mesh(roundedBox(0.045, 0.64, 0.39, 0.003), mats.iron);
      side.position.set(rx, 0.32, -0.005);
      legacy.add(side);
    }
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const core = fixtureCoreBatcher.mount(
        g,
        [{ model: 'apparel_wall' }],
        { name: `${f.id}FixtureCore` },
      );
      if (!core) return;
      disposeReplacedFixture(legacy);
    });
    const bounds = fixtureRect(f);
    addCol(colBoxAt(f.x, f.z, bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ));
    return g;
  }

  // ----------------------------------------------------------- hat wall -----
  // The Sheet-03 hat wall replaces the old hat tree on the same footprint:
  // a freestanding slat panel with twelve brass pegs, finished on the back
  // (it stands mid-floor in the apparel zone). The tree remains the stand-in.
  function hatstandUnit(f) {
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.75, 10), mats.walnut);
    pole.position.y = 0.87;
    pole.castShadow = true;
    legacy.add(pole);
    for (const [py, r] of [[0.42, 0.09], [1.72, 0.07]]) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, 0.05, 10), mats.walnutDark);
      collar.position.y = py;
      legacy.add(collar);
    }
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.07, 12), mats.walnutDark);
    foot.position.y = 0.035;
    legacy.add(foot);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.28, 6), mats.brass);
      peg.rotation.z = Math.PI / 2;
      peg.rotation.y = a;
      const py = 1.15 + (i % 2) * 0.35;
      peg.position.set(Math.sin(a) * 0.15, py, Math.cos(a) * 0.15);
      legacy.add(peg);
    }
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const core = fixtureCoreBatcher.mount(
        g,
        [{ model: 'hat_wall' }],
        { name: `${f.id}FixtureCore` },
      );
      if (!core) return;
      disposeReplacedFixture(legacy);
    });
    addFixtureCollider(f);
    return g;
  }

  // ------------------------------------------------------ apparel wall -----
  // Asset 21 is a real stocking fixture, not architectural dressing. Eight
  // compact face-out garments and four folded stacks land on authored sockets.
  function apparelwallUnit(f) {
    const g = new THREE.Group();
    g.name = 'ApparelWallDisplayFixture';
    if (merch) merch.onReady(() => {
      fixtureCoreBatcher.mount(
        g,
        [{ model: 'apparel_wall_display' }],
        { name: `${f.id}FixtureCore` },
      );
    });
    addFixtureCollider(f);
    return g;
  }

  // -------------------------------------------------------- bag platform ----
  // The Sheet-03 bag display: a walnut deck on a steel frame with a rear lean
  // rail, bags standing four across. The old two-tier platform stands in.
  function bagstandUnit(f) {
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    const lowTier = new THREE.Mesh(roundedBox(2.5, 0.12, 1.15, 0.025), mats.walnut);
    lowTier.position.set(0, 0.06, 0.05);
    lowTier.castShadow = true;
    lowTier.receiveShadow = true;
    legacy.add(lowTier);
    const highTier = new THREE.Mesh(roundedBox(2.5, 0.3, 0.5, 0.025), mats.walnut);
    highTier.position.set(0, 0.15, -0.45);
    highTier.castShadow = true;
    legacy.add(highTier);
    const backRail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.4, 8), mats.brass);
    backRail.rotation.z = Math.PI / 2;
    backRail.position.set(0, 1.02, -0.45);
    legacy.add(backRail);
    for (const px of [-1.15, 1.15]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 1.0, 8), mats.iron);
      post.position.set(px, 0.5, -0.45);
      legacy.add(post);
    }
    const legacySign = categorySign(f.title, { w: 1.0, h: 0.2 });
    legacySign.position.set(0, 1.16, -0.45);
    legacy.add(legacySign);
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const core = fixtureCoreBatcher.mount(
        g,
        [{ model: 'bag_display' }],
        { name: `${f.id}FixtureCore` },
      );
      if (!core) return;
      disposeReplacedFixture(legacy);
    });
    addFixtureCollider(f);
    return g;
  }

  // ------------------------------------------------------- lit shoe wall ----
  // Two Sheet-03 shoe_wall modules (angled boards, box shelf, crest header)
  // replace the lit millwork; the fitting bench and mirror stay.
  function shoerackUnit(f) {
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.7, 2.1, 0.05), mats.walnutDark);
    back.position.set(0, 1.05, -0.22);
    back.receiveShadow = true;
    legacy.add(back);
    for (const sx of [-1.34, 1.34]) {
      const side = new THREE.Mesh(roundedBox(0.07, 2.1, 0.5, 0.02), mats.walnut);
      side.position.set(sx, 1.05, -0.02);
      side.castShadow = true;
      legacy.add(side);
    }
    const crown = new THREE.Mesh(roundedBox(2.86, 0.12, 0.56, 0.025), mats.walnut);
    crown.position.set(0, 2.14, -0.02);
    legacy.add(crown);
    const legacySign = categorySign(f.title);
    legacySign.position.set(0, 1.88, 0.2);
    legacy.add(legacySign);
    // angled shoe boards (merch contract y) with lips + light strips
    for (const y of [0.35, 0.85, 1.35]) {
      const board = new THREE.Mesh(roundedBox(2.6, 0.04, 0.44, 0.012), mats.walnut);
      board.position.set(0, y, 0.02);
      board.rotation.x = -0.18;
      board.receiveShadow = true;
      legacy.add(board);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.03, 0.015), mats.brass);
      lip.position.set(0, y - 0.035, 0.22);
      legacy.add(lip);
      const strip = lightStrip(mats, 2.45);
      strip.position.set(0, y - 0.055, 0.14);
      legacy.add(strip);
    }
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const core = fixtureCoreBatcher.mount(
        g,
        [-0.6, 0.6].map((x) => ({ model: 'shoe_wall', position: [x, 0, 0] })),
        { name: `${f.id}FixtureCore` },
      );
      if (!core) return;
      core.structure.children.forEach((module, index) => {
        qualifyKitSockets(module, f.id, index === 0 ? 'L' : 'R');
      });
      disposeReplacedFixture(legacy);
    });
    // The fitting bench is part of the fixture's declared composite footprint.
    // Keeping it in local space makes it follow moves and quarter-turns exactly.
    const benchG = new THREE.Group();
    const cushion = new THREE.Mesh(roundedBox(1.1, 0.14, 0.42, 0.05), mats.sageFabric);
    cushion.position.y = 0.38;
    const benchBody = new THREE.Mesh(roundedBox(1.1, 0.3, 0.42, 0.02), mats.walnut);
    benchBody.position.y = 0.16;
    benchBody.castShadow = true;
    benchG.add(benchBody, cushion);
    benchG.position.set(0, 0, 0.95);
    g.add(benchG);
    addFixtureCollider(f);
    return g;
  }

  // ------------------------------------------------------ feature table -----
  // The Sheet-04 centre merchandise table (1.40 x 0.80, two-tier walnut on
  // steel) replaces the round pedestal as the feature spot. The featured
  // stock is dressed onto its top grid by rebuildStock (top 0.75, lower
  // shelf 0.29). The pedestal stands in until the kit loads.
  function featureUnit(f) {
    return assetUnit(f, 'feature_table', { w: 2.1, d: 1.3 });
    /* istanbul ignore next -- procedural predecessor retained as a height reference */
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.08, 24), mats.walnut);
    top.position.y = 0.9;
    top.castShadow = true;
    top.receiveShadow = true;
    legacy.add(top);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.885, 0.885, 0.03, 24), mats.brass);
    band.position.y = 0.87;
    legacy.add(band);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.86, 12), mats.walnutDark);
    column.position.y = 0.44;
    legacy.add(column);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.06, 20), mats.walnutDark);
    foot.position.y = 0.03;
    legacy.add(foot);
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const core = fixtureCoreBatcher.mount(
        g,
        [
          { model: 'merch_table' },
          // The merch-table top is 0.75 m above the floor. Leave only a
          // millimetre of clearance so the countertop display reads as seated
          // on the walnut instead of hovering over it.
          { model: 'rangefinder_display', position: [0, 0.751, 0] },
        ],
        { name: `${f.id}FixtureCore` },
      );
      if (!core) return;
      disposeReplacedFixture(legacy);
      // The clubhouse-level merch-ready callback dresses every fixture after
      // all kit callbacks have mounted. Rebuilding here ran the full stock bake
      // once in the middle of relayFixtures and then again at the normal end.
    });
    addFixtureCollider(f);
    return g;
  }

  // ------------------------------------------------------- back counter -----
  function backcounterUnit(f) {
    const g = new THREE.Group();
    // lower cabinets with doors + brass pulls
    const cab = new THREE.Mesh(roundedBox(3.2, 0.95, 0.5, 0.02), mats.walnut);
    cab.position.set(0, 0.48, 0);
    cab.castShadow = true;
    g.add(cab);
    const cabTop = new THREE.Mesh(roundedBox(3.3, 0.06, 0.56, 0.02), mats.walnutDark);
    cabTop.position.set(0, 0.98, 0);
    g.add(cabTop);
    for (let i = 0; i < 4; i++) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.02), mats.walnutDark);
      door.position.set(-1.2 + i * 0.8, 0.46, 0.26);
      g.add(door);
      const pull = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6), mats.brass);
      pull.position.set(-1.2 + i * 0.8 + 0.26, 0.52, 0.27);
      g.add(pull);
    }
    // hutch shelves above for branded bags + boxes
    for (const y of [1.5, 1.95]) {
      const board = new THREE.Mesh(roundedBox(3.0, 0.045, 0.32, 0.015), mats.walnut);
      board.position.set(0, y, -0.08);
      g.add(board);
      const strip = lightStrip(mats, 2.85);
      strip.position.set(0, y - 0.03, -0.02);
      g.add(strip);
    }
    for (const sx of [-1.55, 1.55]) {
      const cheek = new THREE.Mesh(roundedBox(0.07, 1.35, 0.36, 0.02), mats.walnut);
      cheek.position.set(sx, 1.6, -0.08);
      g.add(cheek);
    }
    // The hutch was two lit boards with NOTHING on them — the back counter is
    // where a pro shop keeps its branded bags and boxed stock (ref 4).
    if (merch) merch.onReady(() => {
      // the Sheet-03 rangefinder case presents the premium optics behind the
      // counter, where a shop keeps its $279 glass. It ships EMPTY like every
      // fixture — its felt tiers fill when optics are stocked, not before.
      const dress = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const box = merch.instantiate('carton');
        if (!box) break;
        box.scale.setScalar(0.40 + (i % 3) * 0.06);
        box.position.set(-1.25 + i * 0.42, 1.545, -0.08);
        box.rotation.y = 0.1 * ((i % 2) ? 1 : -1);
        dress.add(box);
      }
      // the club's own carrier bags, stood on the upper shelf
      const bagMat = new THREE.MeshStandardMaterial({ color: 0x2c5233, roughness: 0.86 });
      for (let i = 0; i < 5; i++) {
        const bag = new THREE.Mesh(roundedBox(0.24, 0.30, 0.09, 0.012), bagMat);
        bag.position.set(-1.0 + i * 0.45, 2.12, -0.08);
        bag.rotation.y = 0.08 * ((i % 2) ? 1 : -1);
        bag.castShadow = true;
        dress.add(bag);
        for (const hx of [-0.06, 0.06]) {
          const handle = new THREE.Mesh(
            new THREE.TorusGeometry(0.035, 0.005, 4, 8, Math.PI), mats.kraft);
          handle.position.set(-1.0 + i * 0.45 + hx, 2.27, -0.08);
          handle.rotation.y = Math.PI / 2;
          dress.add(handle);
        }
      }
      g.add(merch.bake(dress));
    });
    addFixtureCollider(f);
    return g;
  }

  // ------------------------------------------------------ backroom shelf ----
  // THE WEAKEST FIXTURE IN THE GAME, per the audit: two flat posts and three
  // bare boards, floating with no feet, no bracing, and nothing on them. A
  // stockroom rack is a FRAME — four uprights, diagonal bracing, feet — and the
  // whole point of a stockroom is that it is FULL (ref 8).
  // Sheet-04 stock_shelving modules (1.20 x 0.50 x 2.00, X-braced steel with
  // four pale boards) replace the welded frame: two modules side by side for
  // the long runs, one for the doorway-adjacent short unit. Board tops sit at
  // 0.1455 / 0.6455 / 1.1455 / 1.6455 — the carton dressing and the ':back'
  // stock in rebuildStock land on those exact planes. The frame stands in
  // until the kit loads.
  function backshelfUnit(f) {
    const g = new THREE.Group();
    const legacy = new THREE.Group();
    const wZ = f.short ? 1.20 : 2.40; // one or two exact authored modules
    const D = 0.50;
    const H = 2.00;
    const boardTops = [0.1455, 0.6455, 1.1455, 1.6455];

    for (const sx of [-wZ / 2 + 0.04, wZ / 2 - 0.04]) {
      for (const sz of [-D / 2 + 0.04, D / 2 - 0.04]) {
        const post = new THREE.Mesh(roundedBox(0.06, H, 0.06, 0.008), mats.iron);
        post.position.set(sx, H / 2, sz);
        post.castShadow = true;
        legacy.add(post);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 0.11), mats.iron);
        foot.position.set(sx, 0.01, sz);
        legacy.add(foot);
      }
    }
    for (const surfaceY of boardTops) {
      const board = new THREE.Mesh(roundedBox(wZ - 0.02, 0.05, D - 0.02, 0.008), mats.rawWood);
      board.position.set(0, surfaceY - 0.025, 0);
      board.receiveShadow = true;
      board.castShadow = true;
      legacy.add(board);
      // the front lip that stops a carton walking off the shelf
      const lip = new THREE.Mesh(new THREE.BoxGeometry(wZ - 0.02, 0.05, 0.018), mats.iron);
      lip.position.set(0, surfaceY + 0.023, D / 2 - 0.03);
      legacy.add(lip);
    }
    // X-bracing across the back — what actually stops a rack racking
    for (let i = 0; i < boardTops.length - 1; i++) {
      const y0 = boardTops[i];
      const y1 = boardTops[i + 1];
      const dy = y1 - y0;
      const len = Math.hypot(wZ - 0.1, dy);
      for (const dir of [1, -1]) {
        const brace = new THREE.Mesh(
          new THREE.BoxGeometry(len, 0.02, 0.014), mats.iron);
        brace.position.set(0, (y0 + y1) / 2, -D / 2 + 0.03);
        brace.rotation.z = dir * Math.atan2(dy, wZ - 0.1);
        legacy.add(brace);
      }
    }
    g.add(legacy);
    if (merch) merch.onReady(() => {
      const spots = f.short ? [0] : [-0.62, 0.62];
      const core = fixtureCoreBatcher.mount(
        g,
        spots.map((x) => ({ model: 'stock_shelving', position: [x, 0, 0] })),
        { name: `${f.id}FixtureCore` },
      );
      if (!core) return;
      disposeReplacedFixture(legacy);
    });
    const swap = Math.abs(Math.sin(f.ry)) > 0.5;
    const colliderLength = wZ + 0.10;
    const colliderDepth = D + 0.12;
    addCol(colBoxAt(
      f.x, f.z,
      swap ? colliderDepth : colliderLength,
      swap ? colliderLength : colliderDepth,
    ));
    return g;
  }

  function pegboardUnit(f) {
    return assetUnit(f, 'pegboard_wall', {
      w: 3.2, d: 0.7, sign: f.sign || f.title, signY: 2.18, signZ: 0.29,
      signW: 1.28, signH: 0.15, priceW: 2.35, priceH: 0.14, charcoal: true,
    });
  }

  function ballwallUnit(f) {
    return assetUnit(f, 'ball_wall', {
      w: 3.2, d: 0.7, sign: f.sign || f.title, signY: 2.18, signZ: 0.36,
      signW: 1.05, signH: 0.15, priceW: 2.30, priceH: 0.14, charcoal: true,
    });
  }

  function hatwallUnit(f) {
    return assetUnit(f, 'hat_wall', {
      w: 1.16, d: 0.60, sign: f.title, signY: 1.98, signZ: 0.31,
      signW: 0.66, signH: 0.12, priceW: 0.58, priceH: 0.12, charcoal: true,
    });
  }

  function shoewallUnit(f) {
    return assetUnit(f, 'shoe_wall', {
      w: 2.7, d: 0.8, sign: f.title, signY: 2.04, signZ: 0.41,
      signW: 0.86, signH: 0.13, priceW: 2.10, priceH: 0.14, charcoal: true,
    });
  }

  function apparelwallUnit(f) {
    return assetUnit(f, 'apparel_wall', {
      w: 3.2, d: 0.7, sign: f.sign || f.title, signY: 2.18, signZ: 0.29,
      signW: 1.28, signH: 0.15, priceW: 2.35, priceH: 0.14, charcoal: true,
    });
  }

  function fittingroomUnit(f) {
    return assetUnit(f, 'fitting_room', {
      w: 2.2, d: 1.7, sign: f.title, signY: 2.30, signZ: 0.86,
      signW: 0.68, signH: 0.12, charcoal: true,
    });
  }

  function fridgeUnit(f) {
    const g = new THREE.Group();
    g.name = 'PineHillsOpeningDrinksCoolerAnchor';

    const sign = categorySign('Cold drinks', { w: 0.70, h: 0.11, charcoal: true });
    sign.position.set(0, 1.89, 0.35);
    g.add(sign);
    const prices = priceRail(f, state, { w: 0.76, h: 0.105 });
    if (prices) {
      prices.position.set(0, 0.18, 0.365);
      g.add(prices);
    }

    addFixtureCollider(f); // permanent carcass / navigation footprint

    // The glass leaf is a separate, state-aware AABB.  Seed it at the exact
    // authored closed pose so collision is safe before the GLB arrives, then
    // follow COL_COOLER_Door's animated world transform every frame.
    const scale = 1 / METERS_PER_YARD;
    const doorWidth = 0.84 * scale;
    const doorDepth = 0.035 * scale;
    const doorLocalZ = 0.2975 * scale;
    const c = Math.cos(f.ry || 0);
    const s = Math.sin(f.ry || 0);
    const doorX = f.x + doorLocalZ * s;
    const doorZ = f.z + doorLocalZ * c;
    const doorAabbWidth = Math.abs(c) * doorWidth + Math.abs(s) * doorDepth;
    const doorAabbDepth = Math.abs(s) * doorWidth + Math.abs(c) * doorDepth;
    const doorCollider = addCol(colBoxAt(
      doorX,
      doorZ,
      Math.max(0.02, doorAabbWidth),
      Math.max(0.02, doorAabbDepth),
    ));
    doorCollider.openingCoolerDoor = true;
    doorCollider.dynamic = true;

    if (merch) merch.onReady(() => {
      if (g.userData.fixtureRetired) return;
      const modelName = 'pine_hills_opening_drinks_cooler_v1';
      const cooler = merch.instantiateRaw?.(modelName);
      if (!cooler) {
        const legacy = merch.instantiate?.('drinks_fridge');
        if (legacy) g.add(legacy);
        return;
      }
      cooler.name = 'PineHillsOpeningDrinksCooler';
      cooler.scale.setScalar(scale);
      g.add(cooler);

      const controller = {
        root: cooler,
        mixer: new THREE.AnimationMixer(cooler),
        clips: [...(merch.animations?.(modelName) || [])],
        doorNode: cooler.getObjectByName(OPENING_DRINKS_COOLER_DOOR.node),
        doorColliderMesh: cooler.getObjectByName('COL_COOLER_Door'),
        doorCollider,
        doorState: null,
        worldDoorBounds: new THREE.Box3(),
      };
      animatedFixtureControllers.set(f.id, controller);
      const initial = openingDrinksCoolerSnapshot(state)?.door.state || 'closed';
      setOpeningCoolerDoorPose(controller, initial, true);
      g.userData.openingCoolerController = controller;
      // Named stock sockets become authoritative as soon as the authored root
      // mounts; redraw without changing a single inventory count.
      B.rebuildStock();
    });
    return g;
  }

  function snackrackUnit(f) {
    return assetUnit(f, 'snack_rack', {
      w: 1.5, d: 0.76, sign: f.title, signY: 1.37, signZ: 0.39,
      signW: 0.50, signH: 0.10, priceW: 1.10, priceH: 0.10, charcoal: true,
    });
  }

  function serviceUnit(f) {
    return assetUnit(f, 'basket_station', {
      w: 0.96, d: 0.76, sign: 'Baskets & cards', signY: 1.30, signZ: 0.39,
      signW: 0.66, signH: 0.13, priceW: 0.70, priceH: 0.11,
    });
  }

  function premiumcaseUnit(f) {
    return assetUnit(f, 'premium_case', {
      w: 2.4, d: 0.8, sign: 'Tour Vault', signY: 2.05, signZ: 0.42,
      signW: 0.95, signH: 0.16, charcoal: true,
    });
  }

  function demoUnit(f) {
    return assetUnit(f, 'putting_demo', { w: 4.0, d: 1.24 });
  }

  function demoRackUnit(f) {
    return assetUnit(f, 'demo_club_rack', {
      w: 0.60, d: 0.48, sign: 'Try a putter', signY: 1.18, signZ: 0.25,
      signW: 0.50, signH: 0.12, charcoal: true, priceY: 0,
    });
  }

  const FIXTURE_BUILDERS = {
    shelf: shelfUnit, pegboard: pegboardUnit, rack: rackUnit, table: tableUnit, rail: railUnit,
    hatstand: hatstandUnit, bagstand: bagstandUnit, shoerack: shoerackUnit,
    apparelwall: apparelwallUnit, fittingroom: fittingroomUnit,
    feature: featureUnit, backcounter: backcounterUnit, backshelf: backshelfUnit,
    fridge: fridgeUnit, snackrack: snackrackUnit, service: serviceUnit,
    premiumcase: premiumcaseUnit, demo: demoUnit,
  };
  // The shop as the PLAYER has it, not as it was designed — placedFixtures() applies whatever they
  // moved, turned or put away, and falls through to the default plan for everything else.
  //
  // Build mode needs to re-lay the floor after every change, so the loop records exactly the
  // colliders and prompts IT created (tracking is off for everything else in this file) and can
  // take them all back without disturbing the counter, the rug or the lounge.
  function layFixtures() {
    tracking = true;
    for (const f of activeFixtures(state)) {
      const build = FIXTURE_BUILDERS[f.kind];
      if (!build) continue;
      activeFixtureId = f.id;
      const g = build(f);
      if (!g.name) g.name = `Fixture_${f.id}`;
      g.userData.fixtureLayoutId = f.id;
      g.position.set(f.x, 0, f.z);
      g.rotation.y = f.ry;
      interior.add(g);
      fixtureAnchors.set(f.id, g);
      fixtureProp(f);
    }
    activeFixtureId = null;
    tracking = false;
  }

  function relayFixtures() {
    for (const c of laidCols) {
      if (c.fixtureColliderActive !== false) removeCol(c);
    }
    for (const p of laidProps) removeProp(p);
    laidCols.length = 0;
    laidProps.length = 0;
    stopAnimatedFixtureControllers();
    for (const g of fixtureAnchors.values()) {
      g.userData.fixtureRetired = true;
      disposeReplacedFixture(g);
    }
    fixtureAnchors.clear();
    layFixtures();
  }

  function setFixtureCollidersActive(fixtureId, active) {
    return setTrackedFixtureCollidersActive(
      laidCols,
      fixtureId,
      active,
      rawAddCol,
      removeCol,
    );
  }

  function fixtureColliderDiagnostics(fixtureId) {
    const colliders = laidCols.filter((collider) => collider.fixtureLayoutId === fixtureId);
    const activeCount = colliders.reduce(
      (count, collider) => count + (collider.fixtureColliderActive !== false ? 1 : 0),
      0,
    );
    return Object.freeze({
      fixtureId,
      total: colliders.length,
      activeCount,
      inactiveCount: colliders.length - activeCount,
      active: colliders.length > 0 && activeCount === colliders.length,
    });
  }

  layFixtures();

  // --- Sheet-03 standing decor (architecture, not re-layable furniture) -----
  const gondolaRoot = new THREE.Group();
  gondolaRoot.name = 'TieredRetailGondola';
  gondolaRoot.position.set(0.4, 0, -0.9);
  interior.add(gondolaRoot);
  if (merch) merch.onReady(() => {
    // The face-out apparel display stands EMPTY beside the shoe wall — its
    // arms and base shelf are landing spots for garments the player hangs,
    // not pre-dressed decor. (Every fixture ships bare; stock is earned.)
    // The Sheet-04 double-sided gondola holds the centre floor between the
    // feature table and the apparel zone. It ships EMPTY — its 24 shelf
    // slots await future product lines.
    const gondola = merch.instantiateKit && merch.instantiateKit('retail_gondola');
    if (gondola) {
      gondolaRoot.add(gondola);
    }
  });
  const gondolaCollider = colBoxAt(0.4, -0.9, 1.3, 0.7);
  let gondolaColliderActive = false;
  function refreshTierDressing() {
    const active = shopTierIndex(state) >= 2;
    gondolaRoot.visible = active;
    if (active && !gondolaColliderActive) {
      rawAddCol(gondolaCollider);
      gondolaColliderActive = true;
    } else if (!active && gondolaColliderActive) {
      removeCol(gondolaCollider);
      gondolaColliderActive = false;
    }
  }
  refreshTierDressing();

  // permanent club logo rug on the entry axis
  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(LOGO_RUG.w, LOGO_RUG.d),
    new THREE.MeshStandardMaterial({ map: makeRugTexture((state && state.clubName) || 'The Club'), roughness: 0.98 }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(LOGO_RUG.x, 0.02, LOGO_RUG.z);
  rug.renderOrder = 1;
  rug.receiveShadow = true;
  interior.add(rug);

  return {
    fixtureAnchors,
    relayFixtures,
    setFixtureCollidersActive,
    fixtureColliderDiagnostics,
    fixtureCoreBatchDiagnostics: fixtureCoreBatcher.diagnostics,
    refreshTierDressing,
    update: updateAnimatedFixtures,
    dispose: stopAnimatedFixtureControllers,
  };
}

// ------------------------------------------------------------- lounge -------
// Furnished from day one (ref 8): two leather club chairs, a round walnut
// coffee table, a bordered rug, and the club-events board. The lounge1 decor
// upgrade still layers the premium suite on top.
export function buildLounge(B) {
  const { interior, mats, merch, addCol, colBoxAt, state } = B;
  const trophyDisplay = new THREE.Group();
  trophyDisplay.name = 'lounge-trophies';
  interior.add(trophyDisplay);
  const syncTier = () => { trophyDisplay.visible = state.shop.unlockedTier < 3; };
  syncTier();

  // The Sheet-04 lounge armchair (0.85 m leather club chair: rolled arms,
  // rolled back rail, walnut feet) — authored to the reference this fixture
  // always chased. Kit front faces +Z at ry 0.
  function clubChair(spot, legacyName, colliderSize = [0.95, 0.95]) {
    addCol(colBoxAt(spot.x, spot.z, colliderSize[0], colliderSize[1]));
    if (!merch) return;
    merch.onReady(() => {
      const model = (merch.instantiateKit && merch.instantiateKit('lounge_armchair'))
        || merch.instantiateRaw('armchair');
      if (!model) return;
      model.name = legacyName;
      model.position.set(spot.x, 0, spot.z);
      model.rotation.y = spot.ry;
      interior.add(model);
    });
  }
  clubChair(LOUNGE.chairA, 'LegacyLoungeChairA', [2.4, 1.15]);
  clubChair(LOUNGE.chairB, 'LegacyLoungeChairB', [1.05, 1.05]);

  // trophies on the partition shelf — were three gold cylinders
  if (merch) merch.onReady(() => {
    const shelf = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const t = merch.instantiate('trophy');
      if (!t) break;
      t.scale.setScalar(0.9 + (i % 2) * 0.22);
      t.position.set(LOUNGE.trophy.x - 0.08, 1.30, LOUNGE.trophy.z - 0.32 + i * 0.32);
      t.rotation.y = -Math.PI / 2 + (i - 1) * 0.2;
      shelf.add(t);
    }
    const display = merch.bake(shelf);
    display.name = 'LegacyLoungeTrophyDisplay';
    interior.add(display);
  });

  // round coffee table + magazines + mug. The magazines and the mug are
  // dressing on whichever top is current: the procedural table (top 0.465)
  // until the kit loads, then the Sheet-04 lounge_coffee_table (top 0.45).
  function coffeeDressing(topY) {
    const d = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const mag = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.008, 0.32),
        new THREE.MeshStandardMaterial({ color: [0x2e5a35, 0xc9d7e4, 0xd7c9a8][i], roughness: 0.7 }),
      );
      mag.position.set(-0.08 + i * 0.05, topY + 0.005 + i * 0.01, 0.02 + i * 0.03);
      mag.rotation.y = i * 0.3 - 0.2;
      d.add(mag);
    }
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.09, 10), mats.greenPaint);
    mug.position.set(0.25, topY + 0.045, -0.12);
    d.add(mug);
    return d;
  }
  const coffee = new THREE.Group();
  coffee.name = 'LegacyLoungeCoffeeTable';
  const cTop = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 20), mats.walnut);
  cTop.position.y = 0.44;
  cTop.castShadow = true;
  coffee.add(cTop);
  const cPost = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.42, 10), mats.walnutDark);
  cPost.position.y = 0.21;
  coffee.add(cPost);
  const cFoot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.04, 16), mats.walnutDark);
  cFoot.position.y = 0.02;
  coffee.add(cFoot);
  coffee.add(coffeeDressing(0.465));
  coffee.position.set(LOUNGE.coffee.x, 0, LOUNGE.coffee.z);
  interior.add(coffee);
  addCol(colBoxAt(LOUNGE.coffee.x, LOUNGE.coffee.z, 1.1, 1.1));
  if (merch) merch.onReady(() => {
    const table = merch.instantiateKit && merch.instantiateKit('lounge_coffee_table');
    if (!table) return;
    const g = new THREE.Group();
    g.name = 'LegacyLoungeCoffeeTable';
    g.add(table, coffeeDressing(0.45));
    g.position.set(LOUNGE.coffee.x, 0, LOUNGE.coffee.z);
    interior.add(g);
    releaseReplacedFixture(coffee, mats, merch);
    // the companion side table in the corner beside chair A
    const side = merch.instantiateKit && merch.instantiateKit('lounge_side_table');
    if (side) {
      side.position.set(2.75, 0, -6.05);
      side.rotation.y = 0.4;
      interior.add(side);
      addCol(colBoxAt(2.75, -6.05, 0.65, 0.65));
    }
  });

  // bordered lounge rug (pine motif, no lettering)
  const loungeRug = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 2.5),
    new THREE.MeshStandardMaterial({ map: makeRugTexture(' ', { w: 256, h: 224 }), roughness: 0.98 }),
  );
  loungeRug.rotation.x = -Math.PI / 2;
  loungeRug.position.set(LOUNGE.rug.x, 0.018, LOUNGE.rug.z);
  loungeRug.renderOrder = 1;
  loungeRug.receiveShadow = true;
  interior.add(loungeRug);

  // club events board on the partition (ref 8's CLUB EVENTS)
  const evTex = makeSignTexture(
    ['CLUB EVENTS', 'Member–Member · May 17–18', 'Pine Classic · June 7', 'Junior Championship · Aug 2–3', 'Fall Classic · Sept 13'],
    { w: 512, h: 640, field: '#f4f0e6', ink: '#1f4a26', pine: false, sizes: [56, 30, 30, 30, 30] },
  );
  const evFrame = new THREE.Mesh(roundedBox(0.05, 1.16, 0.95, 0.02), mats.walnut);
  evFrame.position.set(LOUNGE.events.x + 0.025, 1.62, LOUNGE.events.z);
  interior.add(evFrame);
  const events = new THREE.Mesh(
    new THREE.PlaneGeometry(0.85, 1.06),
    new THREE.MeshStandardMaterial({ map: evTex, roughness: 0.85 }),
  );
  // proud of the backer board so the face can't be swallowed by it
  events.position.set(LOUNGE.events.x - 0.005, 1.62, LOUNGE.events.z);
  events.rotation.y = LOUNGE.events.ry;
  interior.add(events);
  addCol(colBoxAt(LOUNGE.trophy.x, LOUNGE.trophy.z, 0.58, 1.82));
}

// ------------------------------------------------------- stockroom extras ---
// The working room (ref 9): packing bench, cleaning corner, receiving sign.
export function buildStockroomDressing(B) {
  const { interior, mats, merch, addCol, colBoxAt } = B;
  const P = STOCKROOM.packing;

  // A STOCKROOM IS FULL. Ref 8: shelves of cartons, a hand truck, a packing
  // bench. The old one was three bare racks and a mop, and it was the emptiest,
  // weakest room in the building. These cartons are BACKROOM DRESSING — they are
  // not the delivery boxes the player opens (those are spawned by the delivery
  // system and carry real stock); they are what a working backroom looks like.
  // The models arrive asynchronously, well after the shop is built, so the
  // dressing is deferred rather than placed inline — otherwise it would simply
  // never appear.
  if (merch) merch.onReady(() => {
    const RACKS = [
      { x: 8.05, z: -6.1, ry: 0, len: 1.86, levels: [0.3086, 0.8335, 1.3584, 1.8834] },
      { x: 9.9, z: -5.6, ry: -Math.PI / 2, len: 1.7, levels: [0.1205, 0.6205, 1.1205, 1.6205] },
      // backshelf_e2 is reserved for the player's persisted physical cartons.
      // Dressing it as well would duplicate inventory and hide placement ghosts.
    ];
    const dress = new THREE.Group();
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (const rk of RACKS) {
      // the Sheet-04 stock_shelving board tops, less the old 0.025 board
      // half-thickness the carton offset was calibrated against
      for (const y of rk.levels) {
        const n = 2 + Math.floor(rnd() * 3);
        for (let i = 0; i < n; i++) {
          if (rnd() < 0.18) continue;          // a working shelf has gaps in it
          const box = merch.instantiate(rnd() < 0.15 ? 'carton_open' : 'carton');
          if (!box) break;
          const along = -rk.len / 2 + 0.34 + i * (rk.len - 0.6) / Math.max(1, n - 1);
          const s = 0.72 + rnd() * 0.45;       // cartons are not all one size
          box.scale.setScalar(s);
          const lx = rk.x + Math.cos(rk.ry) * along;
          const lz = rk.z - Math.sin(rk.ry) * along;
          box.position.set(lx, y + 0.055, lz);
          box.rotation.y = rk.ry + (rnd() - 0.5) * 0.3;
          dress.add(box);
        }
      }
    }
    // Real delivery boxes and the authored Ref42 hand truck own the receiving
    // door area. Decorative cartons here looked like interactable inventory and
    // the legacy handtruck duplicated the canonical delivery-equipment prop.
    interior.add(merch.bake(dress));

    // Sheet-04 supply totes stay by the packing bench. Decorative returns
    // formerly occupied the real receiving set-down zone at (7.9, -5.0).
    // Kit props keep their own baked materials and stay out of the merged group.
    const TOTES = [
      { name: 'storage_tote_olive', x: P.x - 0.35, z: P.z + 0.55, y: 0, ry: 0.35 },
      { name: 'storage_tote_slate', x: P.x - 0.35, z: P.z + 0.55, y: 0.288, ry: 0.15 },
    ];
    for (const t of TOTES) {
      const tote = merch.instantiateKit && merch.instantiateKit(t.name);
      if (!tote) continue;
      tote.position.set(t.x, t.y, t.z);
      tote.rotation.y = t.ry;
      interior.add(tote);
    }
  });

  // Packing bench: keep the authored worktop clear for a real delivery carton.
  // The clipboard, tape gun, and ref-50 roll live on the lower supply shelf.
  const bench = new THREE.Group();
  bench.name = 'LegacyPackingBench';
  const top = new THREE.Mesh(roundedBox(1.7, 0.07, 0.85, 0.02), mats.rawWood);
  top.position.y = 0.92;
  top.castShadow = true;
  top.receiveShadow = true;
  bench.add(top);
  const under = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.7), mats.rawWood);
  under.position.y = 0.42;
  bench.add(under);
  for (const [lx, lz] of [[-0.78, -0.36], [0.78, -0.36], [-0.78, 0.36], [0.78, 0.36]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.92, 0.06), mats.iron);
    leg.position.set(lx, 0.46, lz);
    bench.add(leg);
  }
  const clipboard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 0.3), mats.trimPaint);
  clipboard.position.set(-0.4, 0.458, 0.1);
  clipboard.rotation.y = 0.3;
  bench.add(clipboard);
  const tapeGun = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.06), mats.charcoal);
  tapeGun.position.set(0.35, 0.485, -0.1);
  tapeGun.rotation.y = -0.4;
  bench.add(tapeGun);
  if (merch) merch.onReady(() => {
    const tapeRoll = merch.instantiate('delivery_packing_tape_roll');
    if (!tapeRoll) return;
    tapeRoll.name = 'PackingBenchTapeRoll';
    // The authored roll is 10 cm in diameter; its 0.50 m centre rests on the
    // lower shelf without competing with the box-placement surface above.
    tapeRoll.position.set(0.18, 0.50, -0.12);
    tapeRoll.rotation.set(Math.PI / 2, -0.2, 0);
    bench.add(tapeRoll);
  });
  bench.position.set(P.x, 0, P.z);
  bench.rotation.y = P.ry;
  interior.add(bench);
  addCol(colBoxAt(P.x, P.z, 1.9, 1.05));

  // Cleaning corner: mop bucket, mop, broom against the partition.
  //
  // These five primitives are a STAND-IN. Assets 71-75 are authored versions of exactly these
  // objects, and when the prop placement table puts them here it disposes this group — otherwise
  // the corner ends up with two mops and two buckets. Grouped and named precisely so that
  // supersession can find it; see assets51to100/propPlacement.js.
  const C = STOCKROOM.cleaning;
  const legacyCleaning = new THREE.Group();
  legacyCleaning.name = 'LegacyCleaningCornerScenery';
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0xd9c944, roughness: 0.7 }));
  bucket.position.set(C.x, 0.15, C.z);
  legacyCleaning.add(bucket);
  const mopPole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.45, 6), mats.rawWood);
  mopPole.position.set(C.x + 0.05, 0.75, C.z + 0.03);
  mopPole.rotation.z = 0.18;
  legacyCleaning.add(mopPole);
  const mopHead = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.16, 8), mats.trimPaint);
  mopHead.position.set(C.x + 0.18, 0.1, C.z + 0.03);
  legacyCleaning.add(mopHead);
  const broomPole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.4, 6), mats.rawWood);
  broomPole.position.set(C.x - 0.22, 0.72, C.z);
  broomPole.rotation.z = -0.14;
  legacyCleaning.add(broomPole);
  const broomHead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), mats.kraft);
  broomHead.position.set(C.x - 0.4, 0.08, C.z);
  legacyCleaning.add(broomHead);
  interior.add(legacyCleaning);
  addCol(colBoxAt(C.x, C.z, 0.7, 0.5));

  // RECEIVING sign over the back door (inside face)
  const recTex = makeSignTexture(['RECEIVING', 'deliveries sign in'], { w: 384, h: 160, sizes: [44, 26] });
  const rec = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.42),
    new THREE.MeshStandardMaterial({ map: recTex, roughness: 0.85 }),
  );
  rec.position.set(INTERIOR.w / 2 - 0.04, 2.62, -3.6);
  rec.rotation.y = -Math.PI / 2;
  interior.add(rec);

  // Give the cart-and-dolly corner a deliberate visual anchor. This restrained
  // operations board replaces a large blank partition in the player view and
  // makes the equipment zone legible from the stockroom doorway.
  // The partition is a 0.25 m solid centered on x=5.7. Mount every layer from
  // its actual stockroom face instead of embedding the sign inside that wall.
  const operationsWallFaceX = STOCKROOM.bounds.minX + SHELL.wallT / 2;
  const operationsBackingX = operationsWallFaceX + 0.026;
  const operationsSignX = operationsWallFaceX + 0.052;
  const operationsFrameX = operationsWallFaceX + 0.058;
  const operationsTex = makeSignTexture(['BACKROOM OPERATIONS', 'CARTS  •  RECEIVING'], {
    w: 640, h: 240, field: '#f1ecdc', ink: '#173f29', sizes: [58, 34],
  });
  const operationsBoard = new THREE.Mesh(
    new THREE.PlaneGeometry(1.92, 0.72),
    new THREE.MeshStandardMaterial({
      map: operationsTex,
      roughness: 0.84,
      side: THREE.DoubleSide,
    }),
  );
  operationsBoard.name = 'BackroomOperationsBoard';
  // Center the board behind the cart bay instead of the far hand-truck corner;
  // from both stockroom doors this is the large otherwise-empty partition.
  operationsBoard.position.set(operationsSignX, 1.68, -3.28);
  operationsBoard.rotation.y = Math.PI / 2;
  interior.add(operationsBoard);
  const operationsBacking = new THREE.Mesh(
    roundedBox(0.045, 0.84, 2.06, 0.025),
    mats.greenPaint,
  );
  operationsBacking.name = 'BackroomOperationsBoardBacking';
  operationsBacking.position.set(operationsBackingX, 1.68, -3.28);
  interior.add(operationsBacking);
  for (const [name, y, z, h, d] of [
    ['Top', 2.085, -3.28, 0.035, 2.04],
    ['Bottom', 1.275, -3.28, 0.035, 2.04],
    ['North', 1.68, -4.282, 0.78, 0.035],
    ['South', 1.68, -2.278, 0.78, 0.035],
  ]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.026, h, d), mats.brass);
    rail.name = `BackroomOperationsBoardFrame${name}`;
    rail.position.set(operationsFrameX, y, z);
    interior.add(rail);
  }

  const handTruckSafetyTex = makeSignTexture(['LOAD SAFELY', 'SECURE  •  TILT  •  MOVE'], {
    w: 512, h: 224, field: '#173f29', ink: '#f1ecdc', accent: '#b89a4e',
    secondaryInk: '#e3d8b7', sizes: [62, 30],
  });
  const handTruckSafety = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 0.50),
    new THREE.MeshStandardMaterial({
      map: handTruckSafetyTex,
      roughness: 0.84,
      side: THREE.DoubleSide,
    }),
  );
  handTruckSafety.name = 'HandTruckSafetyPlacard';
  handTruckSafety.position.set(operationsSignX, 1.55, -5.72);
  handTruckSafety.rotation.y = Math.PI / 2;
  interior.add(handTruckSafety);
  const handTruckSafetyBacking = new THREE.Mesh(
    roundedBox(0.045, 0.60, 1.25, 0.025),
    mats.walnut,
  );
  handTruckSafetyBacking.name = 'HandTruckSafetyPlacardBacking';
  handTruckSafetyBacking.position.set(operationsBackingX, 1.55, -5.72);
  interior.add(handTruckSafetyBacking);

  const addEquipmentParkingBay = (layout, width, depth, name) => {
    const bay = new THREE.Group();
    bay.name = name;
    bay.position.set(layout.x, 0.011, layout.z);
    bay.rotation.y = layout.ry;
    const thickness = 0.025;
    for (const z of [-depth / 2, depth / 2]) {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.008, thickness),
        mats.brass,
      );
      line.position.z = z;
      bay.add(line);
    }
    for (const x of [-width / 2, width / 2]) {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(thickness, 0.008, depth),
        mats.brass,
      );
      line.position.x = x;
      bay.add(line);
    }
    interior.add(bay);
  };
  addEquipmentParkingBay(
    DELIVERY_EQUIPMENT_DEFAULT_LAYOUT.delivery_stocking_cart,
    1.18,
    0.68,
    'StockingCartParkingBay',
  );
  addEquipmentParkingBay(
    DELIVERY_EQUIPMENT_DEFAULT_LAYOUT.delivery_hand_truck,
    0.72,
    0.62,
    'HandTruckParkingBay',
  );
}

// ----------------------------------------------------------- checkout -------
// The checkout island + register. The register's canvas screen and its whole
// scan/payment interaction are wired by clubhouse.js (they touch customers,
// live sales, reservations); this builds only the physical kit and returns
// the screen-drawing hook.
export function buildCheckout(B) {
  const { interior, mats, merch, addCol, removeCol, colBoxAt } = B;

  // Campaign availability is presentation-only here. The checkout transaction
  // authority remains in registerMode; these roots let the reopening campaign
  // reveal the physical counter and its hardware without duplicating either.
  const counterVisualRoot = new THREE.Group();
  counterVisualRoot.name = 'CheckoutCounterVisualRoot';
  const hardwareVisualRoot = new THREE.Group();
  hardwareVisualRoot.name = 'CheckoutHardwareVisualRoot';
  let hardwareStaticBatch = null;
  interior.add(counterVisualRoot, hardwareVisualRoot);

  // paneled island: walnut body, panel insets, wood top, brass foot rail
  // This remains a zero-network fallback while the GLB loader is warming up. Once
  // the production Blender counter is ready it is removed as one group, avoiding a
  // duplicate shell or z-fighting surfaces.
  const legacyCounter = new THREE.Group();
  legacyCounter.name = 'LegacyCheckoutCounter';
  legacyCounter.position.set(COUNTER.x, 0, COUNTER.z);
  legacyCounter.rotation.y = COUNTER.ry;
  counterVisualRoot.add(legacyCounter);
  const body = new THREE.Mesh(roundedBox(COUNTER.len, 0.96, COUNTER.depth - 0.16, 0.02), mats.walnut);
  body.position.set(0, 0.5, 0);
  body.castShadow = true;
  legacyCounter.add(body);
  const panelCount = 5;
  const panelWidth = (COUNTER.len - 0.48) / panelCount;
  for (let i = 0; i < panelCount; i++) {
    const inset = new THREE.Mesh(new THREE.BoxGeometry(panelWidth - 0.10, 0.6, 0.02), mats.walnutDark);
    inset.position.set(-COUNTER.len / 2 + 0.24 + panelWidth * (i + 0.5), 0.52, -COUNTER.depth / 2 + 0.07);
    legacyCounter.add(inset);
  }
  const top = new THREE.Mesh(roundedBox(COUNTER.len + 0.2, 0.07, COUNTER.depth + 0.06, 0.025), mats.walnutDark);
  top.position.set(0, 1.02, 0);
  top.castShadow = true;
  top.receiveShadow = true;
  legacyCounter.add(top);
  const footRail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, COUNTER.len, 8), mats.brass);
  footRail.rotation.z = Math.PI / 2;
  footRail.position.set(0, 0.16, -COUNTER.depth / 2 + 0.02);
  legacyCounter.add(footRail);

  const returnMaxLocal = FRONT_DESK_FRAME.returnStaffExtent;
  const returnSpan = returnMaxLocal - FRONT_DESK_FRAME.frontDepth / 2;
  const returnFallback = new THREE.Mesh(
    roundedBox(FRONT_DESK_FRAME.returnCollisionWidth - 0.16, 0.96, returnSpan, 0.02),
    mats.walnut,
  );
  returnFallback.position.set(
    -FRONT_DESK_FRAME.frontLength / 2 + FRONT_DESK_FRAME.returnCollisionWidth / 2,
    0.5,
    FRONT_DESK_FRAME.frontDepth / 2 + returnSpan / 2,
  );
  returnFallback.castShadow = true;
  legacyCounter.add(returnFallback);
  const returnTop = new THREE.Mesh(
    roundedBox(FRONT_DESK_FRAME.returnCollisionWidth + 0.06, 0.07, returnSpan + 0.12, 0.025),
    mats.walnutDark,
  );
  returnTop.position.set(returnFallback.position.x, 1.02, returnFallback.position.z);
  returnTop.castShadow = true;
  legacyCounter.add(returnTop);

  const counterColliders = [FRONT_DESK_COLLIDERS.frontRun, FRONT_DESK_COLLIDERS.returnRun]
    .map((rect) => colBoxAt(
      (rect.minX + rect.maxX) / 2,
      (rect.minZ + rect.maxZ) / 2,
      rect.maxX - rect.minX + 0.20,
      rect.maxZ - rect.minZ + 0.20,
    ));
  let counterColliderActive = false;
  const setCounterColliderActive = (active) => {
    if (active && !counterColliderActive) {
      counterColliders.forEach(addCol);
      counterColliderActive = true;
    } else if (!active && counterColliderActive) {
      counterColliders.forEach(removeCol);
      counterColliderActive = false;
    }
  };
  setCounterColliderActive(true);

  if (merch) merch.onReady(() => {
    const returnModule = merch.instantiateRaw
      && merch.instantiateRaw('pine_hills_front_desk_return_v1');
    if (returnModule) {
      // Keep the Blender collision hulls available in the shipped GLB for
      // validation, but never let those coplanar authoring meshes enter the
      // render or raycast paths. This hardens the raw-instantiation contract
      // at the integration boundary that owns the supplemental module.
      returnModule.traverse((object) => {
        if (!object.isMesh || !/^(?:COL_|COLLISION_|VOLUME_)/i.test(object.name || '')) return;
        object.visible = false;
        object.layers.mask = 0;
        object.raycast = () => {};
      });
      returnModule.scale.setScalar(FRONT_DESK_ASSETS.scale);
      returnModule.position.set(
        FRONT_DESK_ASSETS.returnModule.x,
        0,
        FRONT_DESK_ASSETS.returnModule.z,
      );
      returnModule.rotation.y = FRONT_DESK_ASSETS.returnModule.ry;
      // The supplemental L-return has no animation or moving component. Bake
      // its visible hierarchy to one draw per authored material while it is
      // still detached, retaining the canonical runtime lookup name on the
      // replacement group. Hidden COL_* meshes stay excluded by visibleOnly.
      const returnSource = new THREE.Group();
      returnSource.add(returnModule);
      const returnVisual = merch.bake
        ? merch.bake(returnSource, { visibleOnly: true })
        : returnModule;
      returnVisual.name = 'PineHillsFrontDeskReturn';
      returnVisual.userData.authoredSource = 'pine_hills_front_desk_return_v1';
      counterVisualRoot.add(returnVisual);
    }

    // Prefer the current Blender production counter, retaining the older kit as
    // a zero-network fallback while its prototype is unavailable.
    const productionCounter = merch.instantiate && merch.instantiate('checkout_counter');
    const counter = productionCounter
      || (merch.instantiateKit && merch.instantiateKit('checkout_counter'));
    if (!counter) return;
    if (productionCounter) {
      // Blender-authored at 3.10 m wide, 0.992 m deep, with the worktop at
      // 1.015 m. Preserve that near-real-world shape while fitting the layout.
      counter.scale.set(
        (2.93 / 0.9144) / 3.10,
        COUNTER_TOP / 1.015,
        (0.91 / 0.9144) / 0.992,
      );
      // The authored staging tray supersedes this old flat inlay. Keep the
      // fallback counter untouched; only the known production node is hidden.
      const obsoleteStagingInlay = counter.getObjectByName('StagingInlay');
      if (obsoleteStagingInlay) obsoleteStagingInlay.visible = false;
    } else {
      counter.scale.set(
        (2.93 / 0.9144) / 2.6,
        COUNTER_TOP / 0.95,
        (0.91 / 0.9144) / 0.85,
      );
    }
    counter.position.set(FRONT_DESK_ASSETS.asset61.x, 0, FRONT_DESK_ASSETS.asset61.z);
    counter.rotation.y = FRONT_DESK_ASSETS.asset61.ry;
    // Bake the obsolete shell separately from the task surfaces. Asset 61 replaces only the
    // furniture: the staging/change trays remain live parts of the established transaction.
    const counterRoot = new THREE.Group();
    counterRoot.add(counter);
    const counterVisual = merch.bake
      ? merch.bake(counterRoot, { visibleOnly: true })
      : counterRoot;
    counterVisual.name = 'LegacyCheckoutProductionCounter';
    counterVisual.traverse((object) => {
      if (object.isMesh) object.receiveShadow = false;
    });
    if (!interior.getObjectByName('AssetRuntime_61_front_desk_counter_shell')) {
      counterVisualRoot.add(counterVisual);
    }

    const taskSurfaceRoot = new THREE.Group();

    // Two authored, counter-integrated task surfaces turn the broad worktop
    // into an intentional production line.  Their dimensions are generated in
    // metres by build_checkout_assets.py and their centres come from the same
    // tested REGISTER layout that owns product and change choreography.
    const stagingTray = merch.instantiate && merch.instantiate('checkout_product_staging_tray');
    if (stagingTray) {
      stagingTray.position.set(
        (REGISTER.staging.minX + REGISTER.staging.maxX) / 2,
        COUNTER_TOP + 0.001,
        (REGISTER.staging.minZ + REGISTER.staging.maxZ) / 2,
      );
      stagingTray.rotation.y = COUNTER.ry;
      taskSurfaceRoot.add(stagingTray);
    }
    const changeTray = merch.instantiate && merch.instantiate('checkout_change_handoff_tray');
    if (changeTray) {
      changeTray.position.set(
        REGISTER.changeHandoff.x,
        COUNTER_TOP + 0.001,
        REGISTER.changeHandoff.z,
      );
      changeTray.rotation.y = COUNTER.ry;
      taskSurfaceRoot.add(changeTray);
    }

    const checkoutTaskSurfaceVisual = merch.bake
      ? merch.bake(taskSurfaceRoot, { visibleOnly: true })
      : taskSurfaceRoot;
    checkoutTaskSurfaceVisual.name = 'CheckoutTaskSurfaceVisual';
    // instantiate() deliberately makes these authored surfaces cast-only. The
    // generic stock batcher enables receiving for shelves, so restore the exact
    // checkout render state after batching instead of changing its lighting.
    checkoutTaskSurfaceVisual.traverse((object) => {
      if (object.isMesh) object.receiveShadow = false;
    });
    counterVisualRoot.add(checkoutTaskSurfaceVisual);
    releaseReplacedFixture(legacyCounter, mats, merch);
  });

  // REGISTER KIT. The positions are no longer eyeballed offsets from registerX —
  // they come from REGISTER in shopLayout.js, which was DERIVED against the player's
  // reach circle and the customer's, and which checkout-space.test.js holds open.
  // The card reader sits where BOTH can touch it; the monitor faces the staff; the
  // scanner sits mid-depth so goods pass over it on their way to the bag.
  //
  // The screens are live canvases owned by registerMode.js, because what is ON them
  // is a function of the transaction, not of the furniture.
  // deferred: the models land well after the shop is built
  if (merch) merch.onReady(() => {
    // THE FINISHED CHECKOUT KIT (assets/checkout/glb → vendor/models/checkout).
    // Each device authors its screen face toward -Y, which the exporter converts
    // to the game's +Z staff side at rotation zero. Origins are bottom-centre, so
    // every prop sits directly on COUNTER_TOP.
    const placeKit = (name, spec, {
      ry = null,
      scale = 1,
    } = {}) => {
      const o = merch.instantiateKit && merch.instantiateKit(name, { scale });
      if (!o) return null;
      o.name = `checkout-${name}`;
      o.position.set(spec.x, COUNTER_TOP, spec.z);
      o.rotation.y = ry == null ? (spec.ry || 0) : ry;
      hardwareVisualRoot.add(o);
      return o;
    };
    // The checkout kit is authored at believable real-world dimensions. Keep
    // every device at 1:1 so the fixed camera, sockets, and countertop reach
    // contract all describe the same physical reader and POS.
    const hardwareModels = [];
    const rememberHardware = (name, model) => {
      if (model && CHECKOUT_RIGID_BATCH_HARDWARE.includes(name)) hardwareModels.push(model);
      return model;
    };
    const reg = rememberHardware('pos_monitor', placeKit('pos_monitor', REGISTER.monitor, { scale: 1.0 }));
    // NOT `slotMesh(...).material = screenMaterial`: registerMode hangs its own
    // clean-UV canvas plane onto the kit's POS_Screen face.
    if (reg && B.register) B.register.attachScreen(reg);
    const term = rememberHardware(
      'payment_terminal',
      placeKit('payment_terminal', REGISTER.cardterm, { scale: 1.0 }),
    );
    if (term && B.register) B.register.attachTerm(term);
    // The simplified TCG-style loop rings a product directly into the bag.
    // Keep the legacy scanner available only to the older interaction adapter;
    // it must not occupy the centre of the production counter.
    const scanner = B.register?.simplified ? null : rememberHardware(
      'barcode_scanner',
      placeKit('barcode_scanner', REGISTER.scanner, {
        ry: REGISTER.scanner.ry,
        scale: 1.0,
      }),
    );
    if (scanner && B.register) B.register.attachScanner(scanner);
    const printer = rememberHardware('receipt_printer', placeKit('receipt_printer', REGISTER.printer, {
      scale: 1.0,
    }));
    if (printer && B.register) B.register.attachPrinter(printer);
    // Customer-facing total display, turned toward the queue.
    rememberHardware(
      'customer_display',
      placeKit('customer_display', REGISTER.custdisplay, { scale: 1.15 }),
    );
    hardwareStaticBatch = batchRigidVisualsByPbrResponse(
      hardwareVisualRoot,
      hardwareModels,
      {
        name: 'CheckoutHardwareRigidPbrBatch',
        excludeNames: ['Scanner_Window', 'Scanner_LED', 'Scanner_CashierLED'],
      },
    );
  });

  // the screen is drawn by registerMode from the live transaction — a furniture
  // module has no business deciding what a register says
  const drawRegister = () => {};

  const setAvailability = ({ counter = true, hardware = true } = {}) => {
    counterVisualRoot.visible = !!counter;
    hardwareVisualRoot.visible = !!hardware;
    setCounterColliderActive(!!counter);
  };

  // the spare carriers, folded flat at the bagging end. The OPEN bag you actually
  // drop goods into, the divider and the impulse rack are registerMode's — they are
  // part of the transaction, not part of the room.
  if (!B.register || !B.register.simplified) {
    for (let i = 0; i < 3; i++) {
      const bag = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.02, 0.16),
        new THREE.MeshStandardMaterial({ color: 0x2c4a30, roughness: 0.88 }),
      );
      bag.position.set(REGISTER.bagstand.x, COUNTER_TOP + 0.012 + i * 0.021, REGISTER.bagstand.z);
      bag.rotation.y = COUNTER.ry + 0.08 + i * 0.05;
      bag.castShadow = true;
      hardwareVisualRoot.add(bag);
    }
  }

  return {
    drawRegister,
    setAvailability,
    counterVisualRoot,
    hardwareVisualRoot,
    hardwareStaticBatchDiagnostics: () => hardwareStaticBatch?.diagnostics || null,
  };
}

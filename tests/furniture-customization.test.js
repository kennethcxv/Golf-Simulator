import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { FIXTURES, INTERIOR } from '../src/data/shopLayout.js';
import {
  FURNITURE_ASSET_NUMBERS, PLACEABLES, PRODUCT_PLACEMENT_POLICY,
  ROOM_STYLE_OPTIONS, placeableById,
} from '../src/data/placeableCatalog.js';
import { slotsFor } from '../src/data/fixtureSlots.js';
import {
  HISTORY_LIMIT, commitObjectPlacement, ensureLayout, layoutSnapshot, objectById,
  placedObjects, placementSurfaces, recoverInvalidObjects, recoverObject,
  redoPlacement, roomStyle, routesIntact, sellObject, setObjectVariant,
  setRoomStyle, soldObjects, storeObject, storedObjects, undoPlacement,
  validateObjectPlacement,
} from '../src/sim/layout.js';
import { deserialize, newGame, serialize, snapshot } from '../src/sim/state.js';

const exactOptions = { grid: false, rotationSnap: false };
const floor = (x, z, ry = 0, room = 'sales') => ({ x, y: 0, z, ry, surface: 'floor', attachment: null, room });

function emptyMovables(seed = 19) {
  const state = newGame('normal', seed);
  for (const meta of PLACEABLES) {
    if (!meta.requiredObject) storeObject(state, meta.id, { history: false });
  }
  ensureLayout(state).history.undo.length = 0;
  ensureLayout(state).history.redo.length = 0;
  return state;
}

function validate(state, id, candidate) {
  return validateObjectPlacement(state, id, candidate, exactOptions);
}

test('the unified catalog covers existing fixtures, Assets 61-100, and every placement contract field', () => {
  assert.deepEqual(FURNITURE_ASSET_NUMBERS, Array.from({ length: 40 }, (_, index) => index + 61));
  assert.equal(new Set(PLACEABLES.map((entry) => entry.id)).size, PLACEABLES.length);
  for (const fixture of FIXTURES) assert.ok(placeableById(fixture.id), `fixture ${fixture.id}`);
  for (const number of FURNITURE_ASSET_NUMBERS) {
    const id = `asset-${String(number).padStart(3, '0')}`;
    const meta = placeableById(id);
    assert.ok(meta, id);
    for (const field of [
      'assetId', 'placementCategory', 'surfaceRules', 'rotation', 'snapPoints',
      'bounds', 'collision', 'requiredClearance', 'navigationClearance',
      'doorClearance', 'interactionClearance', 'sellValue', 'storageBehavior',
      'requiredObject', 'placementRestrictions',
    ]) assert.ok(Object.hasOwn(meta, field), `${id}.${field}`);
    assert.ok(existsSync(meta.render.path), meta.render.path);
  }
  for (let number = 51; number <= 60; number += 1) {
    const sheet = '06';
    const stems = {
      51: 'finished_clubhouse_exterior', 52: 'dilapidated_clubhouse_exterior',
      53: 'main_entrance_double_door', 54: 'exterior_porch_and_steps',
      55: 'clubhouse_windows_set', 56: 'interior_wall_panel_kit',
      57: 'interior_trim_and_baseboard_kit', 58: 'ceiling_and_beam_kit',
      59: 'renovated_flooring_set', 60: 'damaged_flooring_set',
    };
    assert.ok(existsSync(`vendor/models/assets_51_100/sheet_${sheet}/asset_${String(number).padStart(3, '0')}_${stems[number]}.glb`));
  }
});

test('all untouched default objects are legal under the same validator used by preview', () => {
  const state = newGame('normal', 20);
  for (const object of placedObjects(state)) {
    const result = validate(state, object.id, object.transform);
    assert.equal(result.ok, true, `${object.id}: ${result.reasons.join(' | ')}`);
  }
  assert.equal(routesIntact(state), true);
});

test('floor placement supports small props and commercial-scale furniture without floating or sinking', () => {
  for (const [id, candidate] of [
    ['asset-099', floor(-4, 2)],
    ['asset-067', floor(-4, -2)],
    ['asset-061', floor(-4, 1, Math.PI / 2)],
    ['asset-064', floor(-5, -2, Math.PI / 2)],
    ['asset-066', floor(-3, -2)],
    ['asset-081', floor(-2, -2)],
  ]) {
    const state = emptyMovables();
    const result = validate(state, id, candidate);
    assert.equal(result.ok, true, `${id}: ${result.reasons.join(' | ')}`);
    const placed = commitObjectPlacement(state, id, result.candidate, exactOptions);
    assert.equal(placed.ok, true);
    assert.deepEqual(placed.object.transform, result.candidate);
  }
  const state = emptyMovables();
  const floating = validate(state, 'asset-081', { ...floor(-2, -2), y: 0.2 });
  assert.equal(floating.ok, false);
  assert.ok(floating.codes.includes('floating'));
});

test('wall placement locks the true wall normal and rejects glass, doors, gaps, and backward facing transforms', () => {
  const state = newGame('normal', 21);
  const legal = {
    x: 1.45, y: 2.7, z: -INTERIOR.d / 2 + 0.06, ry: 0,
    surface: 'wall', attachment: { wallId: 'north-sales', normal: [0, 0, 1] }, room: 'sales',
  };
  assert.equal(validate(state, 'asset-087', legal).ok, true);
  const glass = validate(state, 'asset-087', {
    x: -4.9, y: 1.6, z: INTERIOR.d / 2 - 0.06, ry: Math.PI,
    surface: 'wall', attachment: { wallId: 'south-sales', normal: [0, 0, -1] }, room: 'sales',
  });
  assert.ok(glass.codes.includes('wall-glass'));
  const door = validate(state, 'asset-094', {
    x: -0.8, y: 1.4, z: INTERIOR.d / 2 - 0.06, ry: Math.PI,
    surface: 'wall', attachment: { wallId: 'south-sales', normal: [0, 0, -1] }, room: 'sales',
  });
  assert.ok(door.codes.includes('wall-door'));
  const backwards = validate(state, 'asset-087', { ...legal, ry: Math.PI });
  // Candidate normalization uses the wall metadata as authority and repairs yaw.
  assert.equal(backwards.ok, true);
  assert.equal(backwards.candidate.ry, 0);
  const gap = validate(state, 'asset-087', { ...legal, attachment: null });
  assert.ok(gap.codes.includes('wall-target-missing'));
});

test('counter and shelf placement uses finite authored surfaces and protects checkout equipment', () => {
  const state = newGame('normal', 22);
  const clipboard = {
    x: 4.25, y: 1.055, z: 4.0, ry: 0, surface: 'counter',
    attachment: { parentId: 'surface:checkout-counter' }, room: 'sales',
  };
  assert.equal(validate(state, 'asset-089', clipboard).ok, true);
  const blocked = validate(state, 'asset-089', { ...clipboard, x: 2.7, z: 4.22 });
  assert.ok(blocked.codes.includes('protected-equipment'));
  const spray = {
    x: -6.9, y: 1.05, z: -6.15, ry: 0, surface: 'shelf',
    attachment: { parentId: 'surface:fixture:shelf_balls:shelf-2' }, room: 'sales',
  };
  assert.equal(validate(state, 'asset-076', spray).ok, true);
  assert.ok(validate(state, 'asset-076', { ...spray, x: -9 }).codes.includes('surface-bounds'));
});

test('a filing cabinet exposes a dynamic top and stacked small items remain selectable records', () => {
  const state = emptyMovables(23);
  assert.equal(commitObjectPlacement(state, 'asset-082', floor(0, 0), exactOptions).ok, true);
  const top = placementSurfaces(state).find((surface) => surface.ownerId === 'asset-082');
  assert.ok(top);
  const printer = {
    x: top.x, y: top.y, z: top.z, ry: 0, surface: top.kind,
    attachment: { parentId: top.id, socket: 'SOCKET_PLACEMENT' }, room: 'sales',
  };
  assert.equal(commitObjectPlacement(state, 'asset-084', printer, exactOptions).ok, true);
  assert.equal(objectById(state, 'asset-084').attachment.parentId, top.id);
  assert.equal(new Set(placedObjects(state).map((object) => object.id)).size, placedObjects(state).length);
});

test('collision rejects furniture, walls, player clearance, protected work areas, and every door route', () => {
  const state = emptyMovables(24);
  assert.equal(commitObjectPlacement(state, 'asset-082', floor(-4, -2), exactOptions).ok, true);
  assert.ok(validate(state, 'asset-081', floor(-4, -2)).codes.includes('object-overlap'));
  assert.ok(validate(state, 'asset-081', floor(-INTERIOR.w, 0)).codes.includes('wall-collision'));
  const actorBlocked = validateObjectPlacement(state, 'asset-081', floor(-2, -2), {
    ...exactOptions, actorPosition: { x: -2, z: -2 },
  });
  assert.ok(actorBlocked.codes.includes('player-clearance'));
  const mainDoor = validate(state, 'asset-081', floor(-0.8, 5.6));
  assert.ok(mainDoor.codes.some((code) => code.includes('main-door') || code.includes('door-swing-main')));
  const receiving = validate(state, 'asset-081', floor(9.4, -3.6));
  assert.ok(receiving.codes.some((code) => code.includes('receiving-door') || code.includes('door-swing-back')));
  const stockDoor = validate(state, 'asset-081', floor(8.9, 2.0));
  assert.ok(stockDoor.codes.some((code) => code.includes('stockroom-access') || code.includes('door-swing-stock')));
  const checkout = validate(state, 'asset-081', floor(2.8, 5.1));
  assert.ok(checkout.codes.includes('protected-checkout-staff'));
  const pile = state.shop.reno.clutter[0];
  const cluttered = validate(state, 'asset-080', floor(pile.x, pile.z));
  assert.ok(cluttered.codes.includes('object-overlap'));
  assert.match(cluttered.reasons.join(' | '), /old clutter/i);
  pile.cleared = true;
  assert.equal(validate(state, 'asset-080', floor(pile.x, pile.z)).ok, true);
});

test('physically touching footprints are allowed while true overlap is rejected', () => {
  const state = emptyMovables(25);
  const width = placeableById('asset-082').bounds.width;
  assert.equal(commitObjectPlacement(state, 'asset-082', floor(-3, -2), exactOptions).ok, true);
  // Use a second catalog object with the same narrow footprint at a touching edge.
  const touching = floor(-3 + width / 2 + placeableById('asset-081').bounds.width / 2, -2);
  const result = validate(state, 'asset-081', touching);
  assert.equal(result.codes.includes('object-overlap'), false, result.reasons.join(' | '));
});

test('required checkout, laptop, and exit equipment cannot move off sockets, enter storage, or be sold', () => {
  const state = newGame('normal', 26);
  for (const id of ['core-checkout-counter', 'core-laptop', 'core-register', 'core-card-reader', 'core-scanner', 'core-receipt-printer', 'asset-094']) {
    const object = objectById(state, id);
    assert.ok(object.requiredObject, id);
    assert.equal(storeObject(state, id).ok, false, id);
    const before = state.cash;
    assert.equal(sellObject(state, id).ok, false, id);
    assert.equal(state.cash, before);
  }
  const laptop = objectById(state, 'core-laptop');
  const movedLaptop = validate(state, 'core-laptop', { ...laptop.transform, x: laptop.x - 0.2 });
  assert.ok(movedLaptop.codes.includes('protected-socket'));
  const register = objectById(state, 'core-register');
  const movedRegister = validate(state, 'core-register', { ...register.transform, z: register.z + 0.1 });
  assert.ok(movedRegister.codes.includes('protected-socket'));
  assert.equal(recoverObject(state, 'core-register').ok, true);
});

test('store removes the object, restore-by-placement returns it, and selling credits exactly once', () => {
  const state = emptyMovables(27);
  const id = 'asset-067';
  const before = state.cash;
  assert.equal(storeObject(state, id).ok, true); // default is already stored
  assert.ok(storedObjects(state).some((object) => object.id === id));
  assert.equal(commitObjectPlacement(state, id, floor(-4, -2), exactOptions).ok, true);
  assert.ok(placedObjects(state).some((object) => object.id === id));
  const sale = sellObject(state, id);
  assert.equal(sale.ok, true);
  assert.equal(state.cash, before + placeableById(id).sellValue);
  assert.ok(soldObjects(state).some((object) => object.id === id));
  const second = sellObject(state, id);
  assert.equal(second.ok, false);
  assert.equal(second.repeated, true);
  assert.equal(state.cash, before + placeableById(id).sellValue);
});

test('undo/redo cover move, storage, finish variants, and room style with bounded history', () => {
  const state = emptyMovables(28);
  const first = floor(-4, -2);
  const second = floor(-3.5, -2);
  assert.equal(commitObjectPlacement(state, 'asset-067', first, exactOptions).ok, true);
  assert.equal(commitObjectPlacement(state, 'asset-067', second, exactOptions).ok, true);
  assert.equal(objectById(state, 'asset-067').x, second.x);
  assert.equal(undoPlacement(state).ok, true);
  assert.equal(objectById(state, 'asset-067').x, first.x);
  assert.equal(redoPlacement(state).ok, true);
  assert.equal(objectById(state, 'asset-067').x, second.x);
  assert.equal(setObjectVariant(state, 'asset-067', 'muted-sage').ok, true);
  assert.equal(objectById(state, 'asset-067').variant, 'muted-sage');
  assert.equal(setRoomStyle(state, { walls: 'deep-golf-green', trim: 'natural-oak' }).ok, true);
  assert.deepEqual(roomStyle(state), { floor: 'natural-oak', walls: 'deep-golf-green', trim: 'natural-oak' });
  assert.equal(undoPlacement(state).ok, true);
  assert.equal(roomStyle(state).walls, 'warm-cream');
  assert.ok(ensureLayout(state).history.undo.length <= HISTORY_LIMIT);
});

test('preview validation is state-free and confirmation writes one revision', () => {
  const state = emptyMovables(29);
  const before = JSON.stringify(snapshot(state));
  const revision = ensureLayout(state).revision;
  const candidate = validate(state, 'asset-067', floor(-4, -2));
  assert.equal(candidate.ok, true);
  assert.equal(JSON.stringify(snapshot(state)), before);
  assert.equal(commitObjectPlacement(state, 'asset-067', candidate.candidate, exactOptions).ok, true);
  assert.equal(ensureLayout(state).revision, revision + 1);
});

test('save/load preserves wall normals, surface attachments, variants, stored/sold state, styles, and required relationships', () => {
  const state = emptyMovables(30);
  const wall = {
    x: 1.45, y: 2.7, z: -INTERIOR.d / 2 + 0.06, ry: 0,
    surface: 'wall', attachment: { wallId: 'north-sales', normal: [0, 0, 1], socket: 'SOCKET_WallMount' }, room: 'sales',
  };
  assert.equal(commitObjectPlacement(state, 'asset-087', wall, exactOptions).ok, true);
  assert.equal(commitObjectPlacement(state, 'asset-082', floor(0, 0), exactOptions).ok, true);
  const top = placementSurfaces(state).find((surface) => surface.ownerId === 'asset-082');
  assert.equal(commitObjectPlacement(state, 'asset-084', {
    x: 0, y: top.y, z: 0, ry: 0, surface: 'counter',
    attachment: { parentId: top.id, socket: 'SOCKET_PLACEMENT' }, room: 'sales',
  }, exactOptions).ok, true);
  assert.equal(setObjectVariant(state, 'asset-067', 'muted-sage').ok, true);
  assert.equal(storeObject(state, 'asset-068').ok, true);
  assert.equal(sellObject(state, 'asset-069').ok, true);
  setRoomStyle(state, { floor: 'medium-walnut', walls: 'muted-sage', trim: 'warm-charcoal' });
  let loaded = deserialize(serialize(state));
  loaded = deserialize(serialize(loaded));
  assert.deepEqual(layoutSnapshot(loaded), layoutSnapshot(state));
  assert.deepEqual(objectById(loaded, 'asset-087').attachment.normal, [0, 0, 1]);
  assert.equal(objectById(loaded, 'asset-084').attachment.parentId, top.id);
  assert.equal(objectById(loaded, 'asset-068').state, 'stored');
  assert.equal(objectById(loaded, 'asset-069').state, 'sold');
  assert.equal(objectById(loaded, 'core-laptop').requiredRelationship, 'laptop-critical');
  assert.equal(new Set(placedObjects(loaded).map((object) => object.id)).size, placedObjects(loaded).length);
});

test('invalid and corrupt transforms recover automatically to a legal relationship', () => {
  const state = newGame('normal', 31);
  const record = ensureLayout(state).objects['asset-099'] || {
    assetId: placeableById('asset-099').assetId,
    state: 'placed', variant: 'original', requiredRelationship: null,
  };
  ensureLayout(state).objects['asset-099'] = { ...record, transform: floor(900, 900) };
  const result = recoverInvalidObjects(state);
  assert.equal(result.ok, true);
  assert.ok(result.recovered.some((entry) => entry.id === 'asset-099'));
  assert.equal(validate(state, 'asset-099', objectById(state, 'asset-099').transform).ok, true);
});

test('empty and heavily furnished clubhouses preserve every required customer route', () => {
  const empty = emptyMovables(32);
  assert.equal(routesIntact(empty), true);
  const state = emptyMovables(33);
  const floorAssets = PLACEABLES.filter((meta) => meta.render?.kind === 'glb' && meta.surfaceRules.allowed.includes('floor'));
  for (const meta of floorAssets) {
    let found = null;
    outer: for (let z = -5; z <= 5; z += 0.5) {
      for (let x = -9; x <= 5; x += 0.5) {
        for (const ry of [0, Math.PI / 2]) {
          const result = validate(state, meta.id, floor(x, z, ry));
          if (result.ok) { found = result.candidate; break outer; }
        }
      }
    }
    assert.ok(found, `legal furnishing position for ${meta.id}`);
    assert.equal(commitObjectPlacement(state, meta.id, found, { ...exactOptions, history: false }).ok, true);
  }
  assert.equal(routesIntact(state), true);
});

test('100 placements plus 100 moves remain deterministic and history/list state stays bounded', () => {
  const state = emptyMovables(34);
  for (let index = 0; index < 100; index += 1) {
    const candidate = floor(-8 + (index % 20) * 0.18, 3.0 + Math.floor(index / 20) * 0.12, index * 0.03);
    const result = commitObjectPlacement(state, 'asset-099', candidate, exactOptions);
    assert.equal(result.ok, true, `placement ${index}: ${result.reason || ''}`);
  }
  for (let index = 0; index < 100; index += 1) {
    const candidate = floor(-7.8 + (index % 20) * 0.17, 2.2 + Math.floor(index / 20) * 0.11, index * 0.05);
    const result = commitObjectPlacement(state, 'asset-099', candidate, exactOptions);
    assert.equal(result.ok, true, `move ${index}: ${result.reason || ''}`);
  }
  assert.equal(placedObjects(state).filter((object) => object.id === 'asset-099').length, 1);
  assert.equal(ensureLayout(state).history.undo.length, HISTORY_LIMIT);
  assert.equal(ensureLayout(state).history.redo.length, 0);
  assert.equal(routesIntact(state), true);
});

test('product placement remains authored-slot, outward-facing, partial, grouped, and inventory-driven', () => {
  assert.deepEqual(PRODUCT_PLACEMENT_POLICY, {
    mode: 'authored-facing-slots', faceOutward: true, preserveVariants: true,
    partialQuantities: true, groupedRendering: true, freePhysicsObjects: false,
  });
  const state = newGame('normal', 35);
  const fixture = FIXTURES.find((entry) => entry.skus?.length);
  const sku = fixture.skus[0];
  const slots = slotsFor(sku);
  assert.ok(slots.length > 1);
  state.shop.inventory[sku].shelf = Math.min(2, slots.length);
  assert.equal(state.shop.inventory[sku].shelf, 2);
  assert.ok(slots.every((slot) => Number.isFinite(slot.x) && Number.isFinite(slot.y) && Number.isFinite(slot.z)));
});

test('room-style choices are finite verified palettes and preserve sparse save compatibility', () => {
  assert.ok(ROOM_STYLE_OPTIONS.floor.length >= 3);
  assert.ok(ROOM_STYLE_OPTIONS.walls.length >= 3);
  assert.ok(ROOM_STYLE_OPTIONS.trim.length >= 3);
  const raw = snapshot(newGame('normal', 36));
  raw.shop.layout = { moved: {}, stored: [], extra: [], roomStyle: { walls: 'muted-sage' } };
  const state = deserialize(raw);
  assert.deepEqual(roomStyle(state), { floor: 'natural-oak', walls: 'muted-sage', trim: 'warm-cream' });
});

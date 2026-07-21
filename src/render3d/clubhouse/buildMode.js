// COMMERCIAL-STYLE FIRST-PERSON FURNITURE PLACEMENT.
//
// The simulation owns validity and persistence. This controller supplies a view
// ray, an actual-model preview, controls, and feedback. Preview never mutates
// state; confirmation commits the exact validated transform once.

import * as THREE from 'three';
import {
  ROOM_STYLE_OPTIONS, WALL_SURFACES, placeableById,
} from '../../data/placeableCatalog.js';
import { FIXTURE_HALF, SHELL } from '../../data/shopLayout.js';
import {
  FINE_GRID, GRID, commitObjectPlacement, commitPlacement, ensureLayout, objectById, placedFixtures, placedObjects,
  buyFixtureReplacement, fixtureOwnershipEntries,
  placementSurfaces, recoverObject, redoPlacement, roomStyle, sellObject,
  setObjectVariant, setRoomStyle, soldObjects, storeFixture, storeObject, storedObjects,
  undoPlacement, validateObjectPlacement, validatePlacement,
} from '../../sim/layout.js';
import {
  ensureFurnitureCatalogState, furnitureCatalogAvailability, furnitureEffects,
  installFurniture, purchaseFurniture, purchasedFurnitureInstances, uninstallFurniture,
} from '../../sim/furnitureCatalog.js';
import { makeBuildPanel } from '../../ui/buildPanel.js';
import { applyPlaceableTransform } from './placeables.js';

const GOLD = 0xe7ca76;
const OK = 0x62d48c;
const BAD = 0xf06f68;
const MAX_REACH = 8.0;
const MIN_REACH = 0.22;
const TAU = Math.PI * 2;

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const wrap = (angle) => ((angle % TAU) + TAU) % TAU;
const finitePoint = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);

function sameTransform(a, b) {
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) < 1e-5 && Math.abs(a.y - b.y) < 1e-5
    && Math.abs(a.z - b.z) < 1e-5 && Math.abs(a.ry - b.ry) < 1e-5
    && a.surface === b.surface
    && (a.attachment?.wallId || '') === (b.attachment?.wallId || '')
    && (a.attachment?.parentId || '') === (b.attachment?.parentId || '');
}

function localSurfacePoint(surface, point) {
  const dx = point.x - surface.x;
  const dz = point.z - surface.z;
  const c = Math.cos(surface.ry || 0);
  const s = Math.sin(surface.ry || 0);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

// A carried fixture's ghost is the exact local-space footprint that drives
// fixtureRect(), not a second kind-only approximation. In particular, the shoe
// wall's authored footprint is offset 0.5 yd toward local +Z; centring its ghost
// at the fixture origin made the preview disagree with placement/collision.
export function fixtureGhostProfile(f) {
  if (f.footprint) {
    const { minX, maxX, minZ, maxZ } = f.footprint;
    return {
      width: maxX - minX,
      depth: maxZ - minZ,
      offsetX: (minX + maxX) / 2,
      offsetZ: (minZ + maxZ) / 2,
    };
  }
  const [halfWidth, halfDepth] = FIXTURE_HALF[f.kind] || [1, 1];
  return {
    width: (f.short ? 0.85 : halfWidth) * 2,
    depth: halfDepth * 2,
    offsetX: 0,
    offsetZ: 0,
  };
}

// Older checkout and fixture-economy harnesses intentionally exercise the
// fixture-only controller without a browser camera or DOM. Keep that compact
// compatibility surface so current delivery/stock invariants remain proven,
// while normal gameplay uses the authored-model controller below.
function buildLegacyFixtureMode(B, deps) {
  const { state, hooks = {}, walk, W2L, FLOOR_TOP = 0 } = B;
  const {
    rebuildLayout = () => {}, fixtureAnchors = new Map(), fixtureMoveBlocker = () => null,
    setFixtureStockVisible = () => {}, setFixtureCollidersActive = () => {},
    fixtureColliderDiagnostics = () => null,
  } = deps;
  let active = false;
  let carrying = null;
  let ry = 0;
  let lastCheck = { ok: false, reasons: [] };
  const ghost = { visible: false, position: { x: 0, y: FLOOR_TOP, z: 0 }, rotationY: 0, profile: null };
  const snap = (value) => Math.round(value / GRID) * GRID;
  const aimLocal = () => {
    const point = W2L(walk.x, walk.z);
    return { x: snap(point.x), z: snap(point.z) };
  };
  const focusedFixture = () => placedFixtures(state).find((fixture) => fixtureAnchors.has(fixture.id)) || null;
  const blockerCopy = (blocker, fallback) => typeof blocker === 'string' ? blocker : (blocker?.reason || fallback);
  const shelfUnits = (id) => {
    const fixture = placedFixtures(state).find((entry) => entry.id === id);
    if (!fixture?.skus || !state.shop?.inventory) return 0;
    return fixture.skus.reduce((total, skuId) => total + Math.max(0, Number(state.shop.inventory[skuId]?.shelf) || 0), 0);
  };
  const heldUnits = (id) => {
    const fixture = placedFixtures(state).find((entry) => entry.id === id);
    if (!fixture?.skus || !Array.isArray(state.shop?.held)) return 0;
    const skus = new Set(fixture.skus);
    return state.shop.held.reduce((total, unit) => total + (skus.has(unit?.skuId) ? 1 : 0), 0);
  };
  const restoreFixture = (id) => {
    fixtureAnchors.get(id) && (fixtureAnchors.get(id).visible = true);
    setFixtureCollidersActive(id, true);
    setFixtureStockVisible(id, true);
  };
  const api = {
    isActive: () => active,
    isCarrying: () => carrying,
    isCatalogOpen: () => false,
    enter() { active = true; },
    exit() { if (carrying) api.cancel(); active = false; },
    interact() {
      if (!active) return false;
      if (carrying) {
        const id = carrying;
        const point = aimLocal();
        lastCheck = validatePlacement(state, id, point.x, point.z, ry);
        if (!lastCheck.ok) { hooks.toast?.(lastCheck.reasons[0], 'warn'); return true; }
        commitPlacement(state, id, point.x, point.z, ry);
        carrying = null;
        ghost.visible = false;
        rebuildLayout();
        restoreFixture(id);
        hooks.sfx?.('thunk');
        return true;
      }
      const fixture = focusedFixture();
      if (!fixture) return false;
      const blocker = fixtureMoveBlocker(fixture.id);
      if (blocker) { hooks.toast?.(blockerCopy(blocker, 'Move the carton off this fixture first.'), 'warn'); return true; }
      carrying = fixture.id;
      ry = fixture.ry || 0;
      const point = aimLocal();
      ghost.visible = true;
      ghost.position = { x: point.x, y: FLOOR_TOP, z: point.z };
      ghost.rotationY = ry;
      ghost.profile = fixtureGhostProfile(fixture);
      lastCheck = validatePlacement(state, fixture.id, point.x, point.z, ry);
      const anchor = fixtureAnchors.get(fixture.id);
      if (anchor) anchor.visible = false;
      setFixtureCollidersActive(fixture.id, false);
      setFixtureStockVisible(fixture.id, false);
      return true;
    },
    stow() {
      if (!active || !carrying) return false;
      const id = carrying;
      const blocker = fixtureMoveBlocker(id);
      if (blocker) { hooks.toast?.(blockerCopy(blocker, 'Move the carton off this fixture first.'), 'warn'); return true; }
      const onShelf = shelfUnits(id);
      if (onShelf) { hooks.toast?.(`Empty this fixture before storing it - ${onShelf} shelf item${onShelf === 1 ? '' : 's'} are still on display.`, 'warn'); return true; }
      const held = heldUnits(id);
      if (held) { hooks.toast?.(`Wait for ${held === 1 ? 'the held item' : `${held} held items`} to be sold or returned before storing this fixture.`, 'warn'); return true; }
      storeFixture(state, id);
      carrying = null;
      ghost.visible = false;
      rebuildLayout();
      restoreFixture(id);
      return true;
    },
    cancel() {
      if (!carrying) return false;
      const id = carrying;
      carrying = null;
      ghost.visible = false;
      restoreFixture(id);
      return true;
    },
    rotate(direction = 1) { if (!carrying) return false; ry += Math.PI / 2 * direction; return true; },
    update() {
      if (!active || !carrying) return;
      const point = aimLocal();
      ghost.position = { x: point.x, y: FLOOR_TOP, z: point.z };
      ghost.rotationY = ry;
      lastCheck = validatePlacement(state, carrying, point.x, point.z, ry);
    },
    diagnostics() {
      const colliders = carrying ? fixtureColliderDiagnostics(carrying) : null;
      return Object.freeze({
        active, carrying,
        ghost: Object.freeze({ visible: ghost.visible, position: Object.freeze({ ...ghost.position }), rotationY: ghost.rotationY, profile: ghost.profile ? Object.freeze({ ...ghost.profile }) : null }),
        validation: Object.freeze({ ok: !!lastCheck.ok, reasons: Object.freeze([...(lastCheck.reasons || [])]) }),
        colliderActive: colliders?.active ?? null,
        colliders,
      });
    },
    label: () => active ? (carrying ? '[E] set down · [R] turn · [X] into the back' : 'Build mode — look at a fixture') : null,
    toggleCatalog: () => false,
    toggleGrid: () => true,
    toggleRotationSnap: () => true,
    dispose() { if (carrying) api.cancel(); active = false; },
  };
  return api;
}

export function buildBuildMode(B, deps) {
  const { camera, interior, state, hooks, walk, W2L } = B;
  if (!camera || !deps.placeables) return buildLegacyFixtureMode(B, deps);
  const {
    rebuildLayout,
    fixtureAnchors,
    placeables,
    refreshRoomStyle,
    fixtureMoveBlocker = () => null,
    setFixtureStockVisible = () => {},
    setFixtureCollidersActive = () => {},
    fixtureColliderDiagnostics = () => null,
  } = deps;

  let active = false;
  let carrying = null;
  let original = null;
  let originalState = null;
  let preview = null;
  let previewGeneration = 0;
  let rotation = 0;
  let manualOffset = { x: 0, y: 0, z: 0 };
  let gridEnabled = true;
  let rotationSnapEnabled = true;
  let originalMode = false;
  let lastCheck = { ok: false, reasons: ['Aim at a compatible surface.'], codes: ['no-target'], candidate: null };
  let checkedSignature = '';
  let appliedCandidate = null;
  let focusedId = null;
  let focusClock = 0;
  let pendingSale = null;

  const raycaster = new THREE.Raycaster();
  raycaster.far = MAX_REACH;
  const originWorld = new THREE.Vector3();
  const directionWorld = new THREE.Vector3();
  const endWorld = new THREE.Vector3();
  const rayOrigin = new THREE.Vector3();
  const rayDirection = new THREE.Vector3();
  const overlayRoot = B.ctx?.scene || interior.parent;

  const previewLayer = new THREE.Group();
  // The municipal environment leases legacy interior visuals off, but keeps
  // this live placement layer available for player-authored furnishings.
  previewLayer.name = 'Course1MunicipalFixtureBuildGhost';
  interior.add(previewLayer);

  const grid = new THREE.GridHelper(20, 80, 0x6ba97c, 0x3e6047);
  grid.name = 'FurniturePlacementGrid';
  grid.material.transparent = true;
  grid.material.opacity = 0.23;
  grid.position.y = 0.012;
  grid.visible = false;
  previewLayer.add(grid);

  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.11, 0.17, 32),
    new THREE.MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.94, side: THREE.DoubleSide, depthTest: false }),
  );
  marker.name = 'Course1MunicipalFixtureBuildHalo';
  marker.renderOrder = 998;
  marker.visible = false;
  previewLayer.add(marker);

  let previewBox = null;
  let focusBox = null;

  function clearBox(box) {
    if (!box) return null;
    box.geometry?.dispose();
    box.material?.dispose();
    box.removeFromParent();
    return null;
  }

  function makeBox(object, color) {
    const box = new THREE.BoxHelper(object, color);
    box.material.transparent = true;
    box.material.opacity = 0.9;
    box.material.depthTest = false;
    box.renderOrder = 999;
    overlayRoot.add(box);
    return box;
  }

  function localViewRay() {
    camera.getWorldPosition(originWorld);
    camera.getWorldDirection(directionWorld).normalize();
    endWorld.copy(originWorld).add(directionWorld);
    rayOrigin.copy(originWorld);
    interior.worldToLocal(rayOrigin);
    rayDirection.copy(endWorld);
    interior.worldToLocal(rayDirection);
    rayDirection.sub(rayOrigin).normalize();
    return { origin: rayOrigin, direction: rayDirection };
  }

  function planeHit(axis, at, origin, direction) {
    const denominator = direction[axis];
    if (Math.abs(denominator) < 1e-5) return null;
    const distance = (at - origin[axis]) / denominator;
    if (distance < MIN_REACH || distance > MAX_REACH) return null;
    const point = origin.clone().addScaledVector(direction, distance);
    return { point, distance };
  }

  function surfaceTargets(meta) {
    const allowed = new Set(meta.surfaceRules.allowed);
    const { origin, direction } = localViewRay();
    const hits = [];

    if (allowed.has('floor')) {
      let hit = planeHit('y', 0, origin, direction);
      // Looking almost level is common while carrying a sofa. Keep it visible a
      // comfortable distance ahead instead of making the preview disappear.
      if (!hit) {
        const point = origin.clone().addScaledVector(direction, 3.2);
        point.y = 0;
        hit = { point, distance: 3.2 };
      }
      hits.push({
        distance: hit.distance,
        transform: { x: hit.point.x, y: 0, z: hit.point.z, ry: rotation, surface: 'floor', attachment: null, room: 'sales' },
      });
    }

    if (allowed.has('counter') || allowed.has('shelf')) {
      for (const surface of placementSurfaces(state)) {
        if (!allowed.has(surface.kind)) continue;
        const hit = planeHit('y', surface.y, origin, direction);
        if (!hit) continue;
        const local = localSurfacePoint(surface, hit.point);
        if (Math.abs(local.x) > surface.width / 2 + 0.08 || Math.abs(local.z) > surface.depth / 2 + 0.08) continue;
        hits.push({
          distance: hit.distance,
          transform: {
            x: hit.point.x, y: surface.y, z: hit.point.z, ry: rotation,
            surface: surface.kind,
            attachment: { parentId: surface.id, socket: null },
            room: surface.room || 'sales',
          },
        });
      }
    }

    if (allowed.has('wall')) {
      for (const wall of WALL_SURFACES) {
        const hit = planeHit(wall.axis, wall.at, origin, direction);
        if (!hit || hit.point.y < 0.12 || hit.point.y > SHELL.h - 0.03) continue;
        const along = wall.coordinate === 'x' ? hit.point.x : hit.point.z;
        if (along < wall.from || along > wall.to) continue;
        hits.push({
          distance: hit.distance,
          transform: {
            x: hit.point.x, y: hit.point.y, z: hit.point.z, ry: wall.yaw,
            surface: 'wall',
            attachment: { wallId: wall.id, normal: [...wall.normal], socket: meta.render?.mountSocket || 'SOCKET_WallMount' },
            room: wall.room,
          },
        });
      }
    }

    if (allowed.has('ceiling')) {
      const hit = planeHit('y', SHELL.h, origin, direction);
      if (hit) hits.push({
        distance: hit.distance,
        transform: {
          x: hit.point.x, y: SHELL.h, z: hit.point.z, ry: rotation,
          surface: 'ceiling', attachment: { socket: meta.render?.mountSocket || 'SOCKET_CeilingMount' }, room: 'sales',
        },
      });
    }

    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }

  function rawCandidate() {
    if (!carrying) return null;
    const meta = placeableById(carrying);
    if (!meta) return null;
    if (originalMode && original) return clone(original);
    const target = surfaceTargets(meta)[0]?.transform;
    if (!target) return null;
    const candidate = {
      ...target,
      x: target.x + manualOffset.x,
      y: target.y + manualOffset.y,
      z: target.z + manualOffset.z,
    };
    if (target.surface !== 'wall') candidate.ry = rotation;
    return candidate;
  }

  function shelfUnitsOnFixture(id) {
    const fixture = placedFixtures(state).find((entry) => entry.id === id);
    const inventory = state.shop && state.shop.inventory;
    if (!fixture || !inventory || !Array.isArray(fixture.skus)) return 0;
    return fixture.skus.reduce((total, skuId) => {
      const shelf = Number(inventory[skuId] && inventory[skuId].shelf);
      return total + (Number.isFinite(shelf) && shelf > 0 ? shelf : 0);
    }, 0);
  }

  function heldUnitsFromFixture(id) {
    const fixture = placedFixtures(state).find((entry) => entry.id === id);
    const held = state.shop && state.shop.held;
    if (!fixture || !Array.isArray(held) || !Array.isArray(fixture.skus)) return 0;
    const skus = new Set(fixture.skus);
    return held.reduce((total, unit) => total + (skus.has(unit?.skuId) ? 1 : 0), 0);
  }

  function validationSignature(candidate) {
    if (!candidate) return `none:${gridEnabled}:${rotationSnapEnabled}`;
    return [candidate.x.toFixed(4), candidate.y.toFixed(4), candidate.z.toFixed(4), candidate.ry.toFixed(4),
      candidate.surface, candidate.attachment?.wallId || '', candidate.attachment?.parentId || '',
      gridEnabled, rotationSnapEnabled].join(':');
  }

  function applyMarker(candidate, ok) {
    if (!candidate) {
      marker.visible = false;
      return;
    }
    marker.visible = true;
    marker.material.color.setHex(ok ? OK : BAD);
    marker.position.set(candidate.x, candidate.y + 0.012, candidate.z);
    marker.rotation.set(-Math.PI / 2, 0, 0);
    if (candidate.surface === 'wall') {
      marker.position.y = candidate.y;
      marker.rotation.set(0, candidate.ry, 0);
    } else if (candidate.surface === 'ceiling') {
      marker.position.y = candidate.y - 0.012;
      marker.rotation.set(Math.PI / 2, 0, 0);
    }
  }

  function statusCopy() {
    if (!active) return { copy: '', kind: '' };
    if (carrying) {
      const object = objectById(state, carrying);
      if (!preview) return { copy: `Loading ${object?.label || 'furniture'} preview…`, kind: 'warn' };
      if (!lastCheck.ok) return { copy: `${object?.label || 'Furniture'} · ${lastCheck.reasons[0]}`, kind: 'invalid' };
      const surface = lastCheck.candidate?.surface || 'surface';
      return {
        copy: `${object?.label || 'Furniture'} · valid ${surface} placement · E to set down`,
        kind: '',
      };
    }
    const object = focusedId && objectById(state, focusedId);
    return object
      ? { copy: `${object.label} · ${object.placementCategory.replaceAll('-', ' ')} · E to move`, kind: '' }
      : { copy: 'Aim at furniture, or press I for the collection', kind: 'warn' };
  }

  function syncStatus() {
    const { copy, kind } = statusCopy();
    panel.setStatus(copy, kind, carrying
      ? 'E place · R rotate · Arrows nudge · Esc cancel'
      : 'I collection · Ctrl+Z undo · B finish');
  }

  function clearPreview() {
    previewGeneration += 1;
    previewBox = clearBox(previewBox);
    if (preview) placeables.releasePreview(preview);
    preview = null;
    marker.visible = false;
    grid.visible = false;
    appliedCandidate = null;
    checkedSignature = '';
  }

  function finishCarry({ revealOriginal = false } = {}) {
    const id = carrying;
    clearPreview();
    if (revealOriginal && id && originalState === 'placed') placeables.setObjectVisible(id, true);
    if (id) {
      setFixtureCollidersActive(id, true);
      setFixtureStockVisible(id, true);
    }
    carrying = null;
    original = null;
    originalState = null;
    originalMode = false;
    manualOffset = { x: 0, y: 0, z: 0 };
    pendingSale = null;
    syncStatus();
  }

  async function beginObject(id) {
    if (!active || carrying) return false;
    const object = objectById(state, id);
    if (!object || object.state === 'sold') {
      hooks.toast?.('That object is no longer available.', 'warn');
      return false;
    }
    if (object.render?.kind === 'existing') {
      hooks.toast?.(`${object.label} is protected equipment. Use recovery if its relationship is ever invalid.`, 'warn');
      return false;
    }
    if (['installation', 'vehicle'].includes(object.placementMode)) {
      hooks.toast?.(`${object.label} is fitted through its Install action in the collection.`, 'warn');
      return false;
    }
    const blocker = fixtureMoveBlocker(id);
    if (blocker) {
      hooks.toast?.(typeof blocker === 'string'
        ? blocker
        : (blocker.reason || 'Move the delivery carton off this fixture first.'), 'warn');
      return false;
    }
    carrying = id;
    original = clone(object.transform);
    originalState = object.state;
    rotation = object.ry || 0;
    manualOffset = { x: 0, y: 0, z: 0 };
    originalMode = false;
    lastCheck = { ok: false, reasons: ['Loading the authored preview.'], codes: ['loading-preview'], candidate: null };
    checkedSignature = '';
    placeables.setObjectVisible(id, false);
    setFixtureCollidersActive(id, false);
    setFixtureStockVisible(id, false);
    focusBox = clearBox(focusBox);
    focusedId = null;
    grid.visible = gridEnabled;
    syncStatus();
    const generation = ++previewGeneration;
    const made = await placeables.previewFor(id);
    if (!made || generation !== previewGeneration || carrying !== id || !active) {
      if (made) placeables.releasePreview(made);
      return false;
    }
    preview = made;
    preview.visible = true;
    previewLayer.add(preview);
    previewBox = makeBox(preview, OK);
    checkedSignature = '';
    return true;
  }

  function objectUnderAim() {
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = raycaster.intersectObjects(placeables.selectableRoots(), true);
    for (const hit of hits) {
      if (hit.distance > MAX_REACH) break;
      let node = hit.object;
      while (node && !node.userData.placeableId) node = node.parent;
      const id = node?.userData?.placeableId || hit.object.userData.placeableId;
      const object = id && objectById(state, id);
      if (object?.state === 'placed' && object.render?.kind !== 'existing') return object;
    }
    return null;
  }

  function refreshFocus(force = false) {
    if (!active || carrying || panel.isOpen()) {
      focusedId = null;
      focusBox = clearBox(focusBox);
      return;
    }
    if (!force && focusClock < 0.08) return;
    focusClock = 0;
    const object = objectUnderAim();
    const nextId = object?.id || null;
    if (nextId === focusedId) {
      focusBox?.update();
      // The catalog clears `focusedId` while its cursor is open. If the player
      // then closes it while aiming at empty space, the identity remains null but
      // the visible status copy still needs to return to the neutral instruction.
      syncStatus();
      return;
    }
    focusedId = nextId;
    focusBox = clearBox(focusBox);
    const root = focusedId && placeables.rootForObject(focusedId);
    if (root) focusBox = makeBox(root, GOLD);
    syncStatus();
  }

  function confirmPlacement() {
    if (!carrying) return false;
    if (!preview || !lastCheck.ok || !lastCheck.candidate) {
      hooks.toast?.(lastCheck.reasons[0] || 'Aim at a compatible surface.', 'warn');
      return true;
    }
    const actor = W2L(walk.x, walk.z);
    const result = commitObjectPlacement(state, carrying, lastCheck.candidate, {
      grid: false, rotationSnap: false, actorPosition: actor,
    });
    if (!result.ok) {
      hooks.toast?.(result.reason, 'warn');
      return true;
    }
    const label = result.object.label;
    finishCarry();
    rebuildLayout();
    hooks.sfx?.('thunk');
    hooks.toast?.(`${label} set exactly where previewed. Navigation refreshed.`);
    panel.refresh();
    return true;
  }

  function interact() {
    if (!active || panel.isOpen()) return false;
    if (carrying) return confirmPlacement();
    const object = objectUnderAim();
    if (!object) return false;
    beginObject(object.id);
    return true;
  }

  function rotate(direction = 1) {
    if (!active || !carrying) return false;
    const meta = placeableById(carrying);
    if (!meta) return false;
    if (lastCheck.candidate?.surface === 'wall' || !meta.rotation?.free && !(meta.rotation?.increment > 0)) {
      hooks.toast?.('That mount follows the wall normal.', 'warn');
      return true;
    }
    const step = rotationSnapEnabled && meta.rotation?.increment > 0
      ? meta.rotation.increment
      : (meta.rotation?.free ? Math.PI / 36 : meta.rotation?.increment || Math.PI / 2);
    rotation = wrap(rotation + step * direction);
    originalMode = false;
    checkedSignature = '';
    return true;
  }

  function nudge(direction, coarse = false) {
    if (!active || !carrying) return false;
    const step = coarse ? GRID : FINE_GRID;
    const surface = lastCheck.candidate?.surface;
    if (surface === 'wall') {
      const wall = WALL_SURFACES.find((entry) => entry.id === lastCheck.candidate.attachment?.wallId);
      if (direction === 'up') manualOffset.y += step;
      else if (direction === 'down') manualOffset.y -= step;
      else if (wall?.coordinate === 'x') manualOffset.x += direction === 'right' ? step : -step;
      else manualOffset.z += direction === 'right' ? step : -step;
    } else {
      const forward = { x: -Math.sin(walk.yaw), z: -Math.cos(walk.yaw) };
      const right = { x: -Math.cos(walk.yaw), z: Math.sin(walk.yaw) };
      const vector = direction === 'up' ? forward : direction === 'down'
        ? { x: -forward.x, z: -forward.z } : direction === 'right' ? right : { x: -right.x, z: -right.z };
      manualOffset.x += vector.x * step;
      manualOffset.z += vector.z * step;
    }
    originalMode = false;
    checkedSignature = '';
    return true;
  }

  function cancel() {
    if (!carrying) return false;
    finishCarry({ revealOriginal: true });
    // Cancellation is deliberately quiet: the original reappears immediately and
    // another transient toast would cover the next object's preview.
    return true;
  }

  function returnOriginal() {
    if (!carrying || !original) return false;
    originalMode = true;
    rotation = original.ry || 0;
    manualOffset = { x: 0, y: 0, z: 0 };
    checkedSignature = '';
    hooks.toast?.('Preview returned to the original saved transform.');
    return true;
  }

  function storeById(id = carrying) {
    if (!id) return false;
    const blocker = fixtureMoveBlocker(id);
    if (blocker) {
      hooks.toast?.(typeof blocker === 'string'
        ? blocker
        : (blocker.reason || 'Move the delivery carton off this fixture first.'), 'warn');
      return true;
    }
    const shelfUnits = shelfUnitsOnFixture(id);
    if (shelfUnits > 0) {
      hooks.toast?.(`Empty this fixture before storing it - ${shelfUnits} shelf item${shelfUnits === 1 ? '' : 's'} are still on display.`, 'warn');
      return true;
    }
    const heldUnits = heldUnitsFromFixture(id);
    if (heldUnits > 0) {
      hooks.toast?.(`Wait for ${heldUnits === 1 ? 'the held item' : `${heldUnits} held items`} to be sold or returned before storing this fixture.`, 'warn');
      return true;
    }
    const result = storeObject(state, id);
    if (!result.ok) {
      hooks.toast?.(result.reason, 'warn');
      return true;
    }
    const label = objectById(state, id)?.label || 'Furniture';
    if (carrying === id) finishCarry();
    rebuildLayout();
    hooks.toast?.(`${label} returned to storage. Its collision and navigation obstacle were removed.`);
    panel.refresh();
    return true;
  }

  function sellById(id = carrying) {
    if (!id) return false;
    const object = objectById(state, id);
    if (!object) return false;
    if (object.requiredObject) {
      const denied = sellObject(state, id);
      hooks.toast?.(denied.reason, 'warn');
      return true;
    }
    const now = performance.now();
    if (!pendingSale || pendingSale.id !== id || pendingSale.until < now) {
      pendingSale = { id, until: now + 4500 };
      hooks.toast?.(`Sell ${object.label} for $${object.sellValue}? Press Delete or Sell again to confirm.`, 'warn');
      return true;
    }
    pendingSale = null;
    const result = sellObject(state, id);
    if (!result.ok) {
      hooks.toast?.(result.reason, 'warn');
      return true;
    }
    if (carrying === id) finishCarry();
    if (object.state === 'installed') refreshRoomStyle();
    rebuildLayout();
    hooks.sfx?.('cash');
    hooks.toast?.(`${object.label} sold for $${result.value}. This object can only be credited once.`);
    panel.refresh();
    return true;
  }

  function replaceById(id) {
    const fixture = fixtureOwnershipEntries(state).find((entry) => entry.id === id);
    if (!fixture || fixture.status !== 'sold') {
      hooks.toast?.('That shop fixture does not need replacing.', 'warn');
      return false;
    }
    const result = buyFixtureReplacement(
      state,
      id,
      `fixture-build-replacement:${id}:${ensureLayout(state).revision}`,
    );
    if (!result.ok) {
      hooks.toast?.(result.reason || 'Could not buy that replacement.', 'warn');
      return false;
    }
    rebuildLayout();
    hooks.sfx?.('cash');
    hooks.toast?.(`${fixture.title} replaced for $${result.cost}. It is ready in storage.`);
    panel.refresh();
    return true;
  }

  function recoverById(id) {
    const result = recoverObject(state, id);
    if (!result.ok) hooks.toast?.(result.reason, 'warn');
    else {
      rebuildLayout();
      hooks.toast?.(`${result.object.label} recovered to its verified safe relationship.`);
    }
    panel.refresh();
    return result.ok;
  }

  function undo() {
    if (carrying) cancel();
    const result = undoPlacement(state);
    if (!result.ok) hooks.toast?.(result.reason, 'warn');
    else {
      rebuildLayout();
      refreshRoomStyle();
      hooks.toast?.('Last customization undone.');
    }
    panel.refresh();
    return result.ok;
  }

  function redo() {
    if (carrying) cancel();
    const result = redoPlacement(state);
    if (!result.ok) hooks.toast?.(result.reason, 'warn');
    else {
      rebuildLayout();
      refreshRoomStyle();
      hooks.toast?.('Customization redone.');
    }
    panel.refresh();
    return result.ok;
  }

  function setStyle(kind, id) {
    if (!ROOM_STYLE_OPTIONS[kind]?.some((option) => option.id === id)) return false;
    const result = setRoomStyle(state, { [kind]: id });
    refreshRoomStyle();
    hooks.sfx?.('paint');
    hooks.toast?.(`${kind[0].toUpperCase() + kind.slice(1)} changed. Dirt and restoration masks are preserved.`);
    panel.refresh();
    return result.ok;
  }

  function cycleVariant(id) {
    const object = objectById(state, id);
    if (!object?.variants?.length || object.variants.length < 2) return false;
    const index = object.variants.indexOf(object.variant);
    const next = object.variants[(index + 1) % object.variants.length];
    const result = setObjectVariant(state, id, next);
    if (result.ok) {
      rebuildLayout();
      hooks.toast?.(`${object.label}: ${next.replaceAll('-', ' ')} finish.`);
      panel.refresh();
    }
    return result.ok;
  }

  function purchaseSku(skuId) {
    const result = purchaseFurniture(state, skuId);
    if (!result.ok) {
      hooks.toast?.(result.reason, 'warn');
      return result;
    }
    hooks.sfx?.('cash');
    const levelCopy = result.levelsGained.length
      ? ` Renovation level ${result.level} unlocked.` : '';
    hooks.toast?.(`${result.item.name} delivered to the collection for $${result.total}.${levelCopy}`);
    panel.refresh();
    return result;
  }

  function installById(id) {
    const result = installFurniture(state, id);
    if (!result.ok) {
      hooks.toast?.(result.reason, 'warn');
      return result;
    }
    refreshRoomStyle();
    rebuildLayout();
    hooks.sfx?.('thunk');
    hooks.toast?.(`${result.item.name} installed. Clubhouse values updated.`);
    panel.refresh();
    return result;
  }

  function uninstallById(id) {
    const object = objectById(state, id);
    const result = uninstallFurniture(state, id);
    if (!result.ok) {
      hooks.toast?.(result.reason, 'warn');
      return result;
    }
    refreshRoomStyle();
    rebuildLayout();
    hooks.toast?.(`${object?.label || 'Installation'} returned to storage.`);
    panel.refresh();
    return result;
  }

  const api = {
    isActive: () => active,
    isCarrying: () => carrying,
    isCatalogOpen: () => panel.isOpen(),
    diagnostics() {
      const colliders = carrying ? fixtureColliderDiagnostics(carrying) : null;
      return Object.freeze({
        active,
        carrying,
        previewVisible: !!preview?.visible,
        validation: Object.freeze({
          ok: !!lastCheck.ok,
          reasons: Object.freeze([...(lastCheck.reasons || [])]),
        }),
        colliderActive: colliders?.active ?? null,
        colliders,
      });
    },
    enter() {
      if (active) return;
      active = true;
      panel.enter();
      refreshFocus(true);
      syncStatus();
    },
    exit() {
      if (carrying) cancel();
      active = false;
      focusedId = null;
      focusBox = clearBox(focusBox);
      marker.visible = false;
      grid.visible = false;
      panel.exit();
    },
    interact,
    beginObject,
    rotate,
    nudge,
    cancel,
    returnOriginal,
    stow: () => storeById(),
    storeById,
    sellById,
    replaceById,
    recoverById,
    undo,
    redo,
    toggleCatalog: () => panel.toggle(),
    toggleGrid() {
      gridEnabled = !gridEnabled;
      grid.visible = !!carrying && gridEnabled;
      checkedSignature = '';
      hooks.toast?.(`Position grid ${gridEnabled ? 'on' : 'off'}.`);
      return true;
    },
    toggleRotationSnap() {
      rotationSnapEnabled = !rotationSnapEnabled;
      checkedSignature = '';
      hooks.toast?.(`Rotation snapping ${rotationSnapEnabled ? 'on' : 'off'}.`);
      return true;
    },
    cycleVariant,
    setStyle,
    purchaseSku,
    installById,
    uninstallById,
    uiModel: () => {
      const fixtureEconomics = new Map(
        fixtureOwnershipEntries(state).map((entry) => [entry.id, entry]),
      );
      const decorateFixture = (object) => {
        const fixture = fixtureEconomics.get(object.id);
        return fixture ? {
          ...object,
          sellValue: fixture.sellValue,
          replacementPrice: fixture.purchasePrice,
          fixtureStatus: fixture.status,
        } : object;
      };
      return {
      placed: placedObjects(state).map(decorateFixture),
      stored: storedObjects(state).map(decorateFixture),
      sold: soldObjects(state).map(decorateFixture),
      installed: purchasedFurnitureInstances(state, { states: ['installed'] })
        .map((instance) => objectById(state, instance.id)).filter(Boolean),
      catalog: furnitureCatalogAvailability(state),
      furniture: { ...ensureFurnitureCatalogState(state), effects: furnitureEffects(state) },
      cash: state.cash,
      reputation: Math.max(0, Number(state.club?.reputation) || 0),
      style: roomStyle(state), revision: ensureLayout(state).revision,
      undoCount: ensureLayout(state).history.undo.length,
      redoCount: ensureLayout(state).history.redo.length,
      gridEnabled, rotationSnapEnabled, carrying,
      };
    },
    label() {
      if (!active || panel.isOpen()) return null;
      if (carrying) {
        return lastCheck.ok
          ? '[E/LMB] place · [R] rotate · [Arrows] nudge · [G] grid · [T] angle snap'
          : 'Adjust placement · [R] rotate · [Arrows] nudge · [Esc/RMB] cancel';
      }
      const object = focusedId && objectById(state, focusedId);
      return object ? `${object.label} · [E/LMB] pick up` : null;
    },
    update(dtMs = 16.7) {
      if (!active) return;
      focusClock += Math.min(0.1, dtMs / 1000);
      if (!carrying) {
        refreshFocus();
        return;
      }
      if (!preview) return;
      const raw = rawCandidate();
      const signature = validationSignature(raw);
      if (signature !== checkedSignature) {
        checkedSignature = signature;
        if (!finitePoint(raw)) {
          lastCheck = { ok: false, reasons: ['Aim at a compatible surface.'], codes: ['no-target'], candidate: null };
        } else {
          lastCheck = validateObjectPlacement(state, carrying, raw, {
            grid: gridEnabled,
            fine: false,
            rotationSnap: rotationSnapEnabled,
            actorPosition: W2L(walk.x, walk.z),
          });
        }
        if (lastCheck.candidate && !sameTransform(appliedCandidate, lastCheck.candidate)) {
          applyPlaceableTransform(preview, placeableById(carrying), lastCheck.candidate);
          appliedCandidate = clone(lastCheck.candidate);
          previewBox?.update();
        }
        placeables.setPreviewValidity(preview, lastCheck.ok);
        if (previewBox) previewBox.material.color.setHex(lastCheck.ok ? OK : BAD);
        applyMarker(lastCheck.candidate, lastCheck.ok);
        syncStatus();
      }
    },
    diagnostics: () => ({
      active, carrying, focusedId, gridEnabled, rotationSnapEnabled,
      candidate: clone(lastCheck.candidate), valid: lastCheck.ok,
      reasons: [...lastCheck.reasons], previewLoaded: !!preview,
    }),
    dispose() {
      api.exit();
      clearPreview();
      focusBox = clearBox(focusBox);
      grid.geometry?.dispose();
      grid.material?.dispose();
      marker.geometry?.dispose();
      marker.material?.dispose();
      previewLayer.removeFromParent();
      panel.dispose();
    },
  };

  const panel = makeBuildPanel({ getApi: () => api });
  return api;
}

// BUILD MODE — the shop is yours to arrange.
//
// Look at a fixture, pick it up, and it lifts off the floor as a translucent ghost that follows
// where you are pointing. Turn it, walk it somewhere else, and put it down. The ghost is green
// where the game will accept it and red where it will not, and it says *why* — you never place
// something and then discover the shop is broken.
//
// Every rule lives in sim/layout.js as arithmetic over the floor plan. This file is just the
// hands: a raycast to the floor, a snapped ghost, and a colour.

import * as THREE from 'three';
import { fixtureRect, FIXTURE_HALF } from '../../data/shopLayout.js';
import { placeableSpec, placeableSpecBySkuId } from '../../data/placeableItems.js';
import {
  placedFixtures, validatePlacement, commitPlacement, storeFixture, GRID,
} from '../../sim/layout.js';
import { ownedPlaceableItems } from '../../sim/propertyInventory.js';
import {
  placeableFootprint,
  placedPlaceableAt,
  snapPlaceablePose,
  validatePlaceablePlacement,
} from '../../sim/propertyPlacement.js';
import {
  moveDecorPlacement,
  placeDecorFree,
  removeDecorPlacement,
  sellStoredDecor,
} from '../../sim/shop.js';

const GHOST_OK = 0x4ade80;
const GHOST_BAD = 0xf87171;

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

export function buildBuildMode(B, deps) {
  const { interior, state, hooks, walk, W2L, L2W, FLOOR_TOP } = B;
  const {
    rebuildLayout,
    rebuildDecor = () => {},
    fixtureAnchors,
    fixtureMoveBlocker = () => null,
    setFixtureStockVisible = () => {},
    setFixtureCollidersActive = () => {},
    fixtureColliderDiagnostics = () => null,
    createPlaceablePreview = () => null,
    setDecorPlacementVisible = () => {},
  } = deps;

  let active = false;
  let carrying = null; // fixture id
  let decorCarry = null; // { itemId, skuId, placementId?, originalPose?, ry }
  let inventoryOpen = false;
  let inventoryIndex = 0;
  let sellConfirmation = null;
  const history = [];
  let ry = 0;
  let lastCheck = { ok: false, reasons: [] };

  const ghost = new THREE.Group();
  ghost.visible = false;
  interior.add(ghost);

  const ghostMat = new THREE.MeshBasicMaterial({
    color: GHOST_OK, transparent: true, opacity: 0.22, depthWrite: false,
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: GHOST_OK, transparent: true, opacity: 0.72 });
  let ghostBox = null;
  let ghostEdges = null;
  let placeableGhost = null;
  let placeableEdges = null;
  let currentGhostProfile = null;

  function disposeMaterial(material) {
    for (const mat of Array.isArray(material) ? material : [material]) {
      if (!mat || mat === ghostMat || mat === edgeMat) continue;
      for (const value of Object.values(mat)) {
        if (value?.isTexture && typeof value.dispose === 'function') value.dispose();
      }
      if (typeof mat.dispose === 'function') mat.dispose();
    }
  }

  function clearPlaceableGhost() {
    if (placeableGhost) {
      placeableGhost.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        disposeMaterial(object.material);
      });
      ghost.remove(placeableGhost);
      placeableGhost = null;
    }
    if (placeableEdges) {
      placeableEdges.geometry.dispose();
      ghost.remove(placeableEdges);
      placeableEdges = null;
    }
  }

  function clearFixtureGhost() {
    if (!ghostBox) return;
    ghost.remove(ghostBox, ghostEdges);
    ghostBox.geometry.dispose();
    ghostEdges.geometry.dispose();
    ghostBox = null;
    ghostEdges = null;
  }

  // the highlight ring under whatever fixture you are looking at
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.1, 0.107, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd479, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthTest: false }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.renderOrder = 998;
  halo.visible = false;
  interior.add(halo);

  function makeGhost(f) {
    clearPlaceableGhost();
    clearFixtureGhost();
    const profile = fixtureGhostProfile(f);
    currentGhostProfile = { ...profile };
    const h = f.kind === 'table' || f.kind === 'feature' ? 0.9 : f.kind === 'hatstand' ? 1.8 : 2.2;
    const geo = new THREE.BoxGeometry(profile.width, h, profile.depth);
    ghostBox = new THREE.Mesh(geo, ghostMat);
    ghostBox.position.set(profile.offsetX, h / 2, profile.offsetZ);
    ghostEdges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
    ghostEdges.position.copy(ghostBox.position);
    ghost.add(ghostBox, ghostEdges);
  }

  function makePlaceableGhost(skuId) {
    clearFixtureGhost();
    clearPlaceableGhost();
    const spec = placeableSpecBySkuId(skuId);
    const profile = spec?.placementProfile;
    if (!profile) return false;
    currentGhostProfile = {
      width: profile.width,
      depth: profile.depth,
      offsetX: profile.offsetX || 0,
      offsetZ: profile.offsetZ || 0,
      mount: profile.mount,
    };
    placeableGhost = createPlaceablePreview(skuId);
    if (!placeableGhost) {
      placeableGhost = new THREE.Group();
      const fallback = new THREE.Mesh(
        new THREE.BoxGeometry(profile.width, Math.max(0.04, profile.height), profile.depth),
        ghostMat,
      );
      fallback.position.set(
        profile.offsetX || 0,
        profile.mount === 'ceiling' ? 2.7 : Math.max(0.04, profile.height) / 2,
        profile.offsetZ || 0,
      );
      placeableGhost.add(fallback);
    } else {
      placeableGhost.traverse((object) => {
        if (!object.isMesh) return;
        disposeMaterial(object.material);
        object.material = ghostMat;
        object.castShadow = false;
        object.receiveShadow = false;
      });
    }
    const outlineGeometry = new THREE.BoxGeometry(
      profile.width,
      Math.max(0.035, profile.mount === 'floor' ? 0.035 : profile.height),
      profile.depth,
    );
    placeableEdges = new THREE.LineSegments(new THREE.EdgesGeometry(outlineGeometry), edgeMat);
    outlineGeometry.dispose();
    placeableEdges.position.set(
      profile.offsetX || 0,
      profile.mount === 'ceiling'
        ? 2.72
        : (profile.mount === 'wall' ? 1.82 : Math.max(0.035, profile.height) / 2),
      profile.offsetZ || 0,
    );
    ghost.add(placeableGhost, placeableEdges);
    return true;
  }

  // where on the floor is the player pointing? (interior-local yards)
  function aimLocal() {
    const eye = { x: walk.x, y: FLOOR_TOP + walk.eye, z: walk.z };
    const cp = Math.cos(walk.pitch);
    const dir = {
      x: -Math.sin(walk.yaw) * cp,
      y: Math.sin(walk.pitch),
      z: -Math.cos(walk.yaw) * cp,
    };
    // where does the view ray meet the floor? if it points up, fall back to a spot ahead.
    let t = dir.y < -0.02 ? (FLOOR_TOP - eye.y) / dir.y : 3.0;
    t = Math.max(1.0, Math.min(6.0, t));
    const p = W2L(eye.x + dir.x * t, eye.z + dir.z * t);
    return { x: Math.round(p.x / GRID) * GRID, z: Math.round(p.z / GRID) * GRID };
  }

  // the fixture the crosshair is over (or nearest to the aim point)
  function fixtureUnderAim() {
    const p = aimLocal();
    let best = null;
    let bestD = 2.2;
    for (const f of placedFixtures(state)) {
      const r = fixtureRect(f);
      const inside = p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
      const d = inside ? 0 : Math.hypot(
        Math.max(r.minX - p.x, 0, p.x - r.maxX),
        Math.max(r.minZ - p.z, 0, p.z - r.maxZ),
      );
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  function placeableEntries() {
    return ownedPlaceableItems(state)
      .filter((item) => item.quantityOwned > 0)
      .sort((a, b) => a.category.localeCompare(b.category) || a.displayName.localeCompare(b.displayName));
  }

  function selectedPlaceable() {
    const entries = placeableEntries();
    if (!entries.length) return null;
    inventoryIndex = ((inventoryIndex % entries.length) + entries.length) % entries.length;
    return entries[inventoryIndex];
  }

  function decorUnderAim() {
    const point = aimLocal();
    return placedPlaceableAt(state, point.x, point.z);
  }

  function decorPose() {
    if (!decorCarry) return null;
    const spec = placeableSpecBySkuId(decorCarry.skuId);
    return snapPlaceablePose(spec, aimLocal(), decorCarry.ry || 0);
  }

  function remember(command) {
    history.push(command);
    if (history.length > 20) history.shift();
  }

  function finishDecorCarry({ restore = false } = {}) {
    if (restore && decorCarry?.placementId) setDecorPlacementVisible(decorCarry.placementId, true);
    decorCarry = null;
    ghost.visible = false;
    clearPlaceableGhost();
    lastCheck = { ok: false, reasons: [] };
  }

  function beginStoredPlaceable() {
    const item = selectedPlaceable();
    if (!item) {
      if (hooks.toast) hooks.toast('Property storage is empty.', 'warn');
      return true;
    }
    if (item.quantityStored < 1) {
      if (hooks.toast) hooks.toast(
        `${item.displayName} has ${item.quantityPlaced} placed and ${item.quantityInTransit} in transit, but none stored.`,
        'warn',
      );
      return true;
    }
    decorCarry = {
      itemId: item.id,
      skuId: item.skuId,
      placementId: null,
      originalPose: null,
      ry: 0,
    };
    inventoryOpen = false;
    sellConfirmation = null;
    makePlaceableGhost(item.skuId);
    ghost.visible = true;
    if (hooks.toast) hooks.toast(`${item.displayName} - [E] place · [R] rotate · [RMB] cancel`);
    return true;
  }

  function beginPlacedDecor(entry) {
    const placement = entry?.placement;
    const spec = entry?.spec;
    if (!placement || !spec) return false;
    decorCarry = {
      itemId: placement.itemId,
      skuId: spec.skuId,
      placementId: placement.id,
      originalPose: structuredClone(placement.pose),
      ry: placement.pose?.ry || 0,
    };
    makePlaceableGhost(spec.skuId);
    ghost.visible = true;
    setDecorPlacementVisible(placement.id, false);
    if (hooks.toast) hooks.toast(`${spec.displayName} - [E] set down · [R] rotate · [X] store · [RMB] cancel`);
    return true;
  }

  function commitDecor() {
    if (!decorCarry) return false;
    const pose = decorPose();
    const checked = validatePlaceablePlacement(state, decorCarry.skuId, pose, {
      exceptPlacementId: decorCarry.placementId,
    });
    lastCheck = checked;
    if (!checked.ok) {
      if (hooks.toast) hooks.toast(checked.reasons[0], 'warn');
      return true;
    }
    if (decorCarry.placementId) {
      const placementId = decorCarry.placementId;
      const before = decorCarry.originalPose;
      const moved = moveDecorPlacement(state, placementId, pose);
      if (!moved.ok) {
        if (hooks.toast) hooks.toast(moved.reason || 'Could not move that item.', 'warn');
        return true;
      }
      remember({ kind: 'move', placementId, before, after: structuredClone(pose) });
    } else {
      const placed = placeDecorFree(state, decorCarry.skuId, pose);
      if (!placed.ok) {
        if (hooks.toast) hooks.toast(placed.reason || 'Could not place that item.', 'warn');
        return true;
      }
      remember({ kind: 'place', placementId: placed.placement.id, skuId: decorCarry.skuId });
    }
    const name = placeableSpecBySkuId(decorCarry.skuId)?.displayName || 'Property item';
    finishDecorCarry();
    rebuildDecor();
    if (hooks.sfx) hooks.sfx('thunk');
    if (hooks.toast) hooks.toast(`${name} placed. [Z] undo`);
    return true;
  }

  function undoLast() {
    if (carrying || decorCarry) {
      if (hooks.toast) hooks.toast('Set down or cancel the item in your hands first.', 'warn');
      return true;
    }
    const command = history.pop();
    if (!command) {
      if (hooks.toast) hooks.toast('Nothing to undo.', 'warn');
      return true;
    }
    let result = null;
    if (command.kind === 'place') result = removeDecorPlacement(state, command.placementId);
    else if (command.kind === 'move') result = moveDecorPlacement(state, command.placementId, command.before);
    else if (command.kind === 'store') result = placeDecorFree(state, command.skuId, command.before);
    if (!result?.ok) {
      history.push(command);
      if (hooks.toast) hooks.toast(result?.reason || 'That change can no longer be undone.', 'warn');
      return true;
    }
    rebuildDecor();
    if (hooks.sfx) hooks.sfx('thunk');
    if (hooks.toast) hooks.toast('Last property placement undone.');
    return true;
  }

  function sellSelected() {
    const item = selectedPlaceable();
    if (!inventoryOpen || !item) return false;
    if (item.quantityStored < 1) {
      if (hooks.toast) hooks.toast('Only stored items can be sold.', 'warn');
      return true;
    }
    const now = performance.now();
    if (!sellConfirmation || sellConfirmation.itemId !== item.id || sellConfirmation.expiresAt < now) {
      sellConfirmation = { itemId: item.id, expiresAt: now + 3000 };
      if (hooks.toast) hooks.toast(
        `Press [Delete] again to sell ${item.displayName} for $${item.sellValue.toFixed(2)}.`,
        'warn',
      );
      return true;
    }
    const operationId = `property-build-sale:${item.id}:${Math.floor(now)}`;
    const sold = sellStoredDecor(state, item.skuId, operationId);
    sellConfirmation = null;
    if (!sold.ok) {
      if (hooks.toast) hooks.toast(sold.reason || 'Could not sell that item.', 'warn');
      return true;
    }
    rebuildDecor();
    if (hooks.sfx) hooks.sfx('coin');
    if (hooks.toast) hooks.toast(`${item.displayName} sold for $${sold.payout.toFixed(2)}.`);
    return true;
  }

  function setGhostColour(ok) {
    ghostMat.color.setHex(ok ? GHOST_OK : GHOST_BAD);
    edgeMat.color.setHex(ok ? GHOST_OK : GHOST_BAD);
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

  return {
    isActive: () => active,
    isCarrying: () => carrying || decorCarry?.placementId || decorCarry?.skuId || null,
    isInventoryOpen: () => inventoryOpen,
    diagnostics() {
      const colliders = carrying ? fixtureColliderDiagnostics(carrying) : null;
      return Object.freeze({
        active,
        carrying,
        decorCarry: decorCarry ? Object.freeze({ ...decorCarry }) : null,
        inventoryOpen,
        inventoryIndex,
        undoDepth: history.length,
        ghost: Object.freeze({
          visible: ghost.visible,
          position: Object.freeze({ x: ghost.position.x, y: ghost.position.y, z: ghost.position.z }),
          rotationY: ghost.rotation.y,
          profile: currentGhostProfile ? Object.freeze({ ...currentGhostProfile }) : null,
        }),
        validation: Object.freeze({
          ok: !!lastCheck.ok,
          reasons: Object.freeze([...(lastCheck.reasons || [])]),
        }),
        colliderActive: colliders?.active ?? null,
        colliders,
      });
    },

    enter() {
      active = true;
      if (hooks.toast) hooks.toast('Build mode - [I] property inventory · look at placed items and [E] to move · [B] stop.');
    },

    exit() {
      if (carrying || decorCarry) this.cancel();
      active = false;
      inventoryOpen = false;
      ghost.visible = false;
      halo.visible = false;
    },

    toggleInventory() {
      if (!active || carrying || decorCarry) return false;
      inventoryOpen = !inventoryOpen;
      sellConfirmation = null;
      return true;
    },

    cycleInventory(direction) {
      if (!active || !inventoryOpen) return false;
      const entries = placeableEntries();
      if (!entries.length) return true;
      inventoryIndex = (inventoryIndex + Math.sign(direction || 1) + entries.length) % entries.length;
      sellConfirmation = null;
      return true;
    },

    inventoryText() {
      if (!active || !inventoryOpen) return '';
      const entries = placeableEntries();
      if (!entries.length) {
        return 'PROPERTY STORAGE\nNo owned placeable items\n\nOrder furnishings from the supplier laptop.\n[I] close';
      }
      const selected = selectedPlaceable();
      const lines = entries.map((item) => {
        const marker = item.id === selected.id ? '›' : ' ';
        const variant = item.variant && item.variant !== 'standard' ? ` · ${item.variant}` : '';
        return `${marker} ${item.displayName}${variant}\n   ${item.category} · Stored ${item.quantityStored} · Placed ${item.quantityPlaced} · Transit ${item.quantityInTransit} · Sell $${item.sellValue.toFixed(2)}`;
      });
      return `PROPERTY STORAGE  ${inventoryIndex + 1}/${entries.length}\n${lines.join('\n')}\n\n[↑/↓] select · [E] place · [Delete] sell stored · [I] close`;
    },

    sellSelected,
    undo: undoLast,

    // E: pick up what you are looking at, or put down what you are holding
    interact() {
      if (!active) return false;
      if (decorCarry) return commitDecor();
      if (inventoryOpen) return beginStoredPlaceable();
      if (carrying) {
        const id = carrying;
        const p = aimLocal();
        const v = validatePlacement(state, id, p.x, p.z, ry);
        if (!v.ok) {
          if (hooks.toast) hooks.toast(v.reasons[0], 'warn');
          return true;
        }
        commitPlacement(state, id, p.x, p.z, ry);
        carrying = null;
        ghost.visible = false;
        active = false;
        halo.visible = false;
        rebuildLayout();
        setFixtureCollidersActive(id, true);
        setFixtureStockVisible(id, true);
        if (hooks.sfx) hooks.sfx('thunk');
        if (hooks.tutorial) hooks.tutorial('fixturePlaced');
        if (hooks.toast) hooks.toast('Fixture placed — customer routes are clear.', 'good');
        return true;
      }
      const decor = decorUnderAim();
      if (decor) return beginPlacedDecor(decor);
      const f = fixtureUnderAim();
      if (!f) return false;
      const blocker = fixtureMoveBlocker(f.id);
      if (blocker) {
        if (hooks.toast) hooks.toast(
          typeof blocker === 'string'
            ? blocker
            : (blocker.reason || 'Move the carton off this fixture first.'),
          'warn',
        );
        return true;
      }
      carrying = f.id;
      ry = f.ry || 0;
      makeGhost(f);
      ghost.visible = true;
      halo.visible = false;
      // lift it off the floor so the room reads as it will without it
      const anchor = fixtureAnchors.get(f.id);
      if (anchor) anchor.visible = false;
      setFixtureCollidersActive(f.id, false);
      setFixtureStockVisible(f.id, false);
      if (hooks.toast) hooks.toast(`${f.title || f.kind} — [E] set down · [R] turn · [X] into the back · [RMB] cancel`);
      return true;
    },

    rotate(fine = false) {
      if (!active) return false;
      if (decorCarry) {
        const profile = placeableSpecBySkuId(decorCarry.skuId)?.placementProfile;
        if (!profile || profile.mount === 'wall') return true;
        const step = fine ? Math.PI / 36 : (profile.rotationStep || Math.PI / 12);
        decorCarry.ry = (decorCarry.ry + step) % (Math.PI * 2);
        return true;
      }
      if (!carrying) return false;
      ry = (ry + Math.PI / 2) % (Math.PI * 2);
      return true;
    },

    // X: take it off the floor entirely
    stow() {
      if (!active) return false;
      if (decorCarry) {
        if (!decorCarry.placementId) return this.cancel();
        const placementId = decorCarry.placementId;
        const skuId = decorCarry.skuId;
        const before = decorCarry.originalPose;
        const stored = removeDecorPlacement(state, placementId);
        if (!stored.ok) {
          if (hooks.toast) hooks.toast(stored.reason || 'Could not store that item.', 'warn');
          return true;
        }
        remember({ kind: 'store', skuId, before });
        finishDecorCarry();
        rebuildDecor();
        if (hooks.sfx) hooks.sfx('thunk');
        if (hooks.toast) hooks.toast('Returned to property storage. [Z] undo');
        return true;
      }
      if (!carrying) return false;
      const id = carrying;
      const blocker = fixtureMoveBlocker(id);
      if (blocker) {
        if (hooks.toast) hooks.toast(
          typeof blocker === 'string'
            ? blocker
            : (blocker.reason || 'Move the carton off this fixture first.'),
          'warn',
        );
        return true;
      }
      const shelfUnits = shelfUnitsOnFixture(id);
      if (shelfUnits > 0) {
        if (hooks.toast) hooks.toast(
          `Empty this fixture before storing it - ${shelfUnits} shelf item${shelfUnits === 1 ? '' : 's'} are still on display.`,
          'warn',
        );
        return true;
      }
      const heldUnits = heldUnitsFromFixture(id);
      if (heldUnits > 0) {
        if (hooks.toast) hooks.toast(
          `Wait for ${heldUnits === 1 ? 'the held item' : `${heldUnits} held items`} to be sold or returned before storing this fixture.`,
          'warn',
        );
        return true;
      }
      storeFixture(state, id);
      carrying = null;
      ghost.visible = false;
      rebuildLayout();
      setFixtureCollidersActive(id, true);
      setFixtureStockVisible(id, true);
      if (hooks.toast) hooks.toast('Into the back it goes.');
      return true;
    },

    cancel() {
      if (inventoryOpen) {
        inventoryOpen = false;
        sellConfirmation = null;
        return true;
      }
      if (decorCarry) {
        finishDecorCarry({ restore: true });
        return true;
      }
      if (!carrying) return false;
      const id = carrying;
      const anchor = fixtureAnchors.get(id);
      if (anchor) anchor.visible = true;
      setFixtureCollidersActive(id, true);
      setFixtureStockVisible(id, true);
      carrying = null;
      ghost.visible = false;
      return true;
    },

    label() {
      if (!active) return null;
      if (inventoryOpen) return 'Property inventory - [↑/↓] select · [E] place · [Delete] sell · [I] close';
      if (decorCarry) {
        return lastCheck.ok
          ? '[E] place · [R] rotate · [X] store · [RMB] cancel · [Z] undo after placing'
          : `Can't go there - ${lastCheck.reasons[0] || 'choose another surface'}`;
      }
      if (carrying) {
        return lastCheck.ok
          ? '[E] set it down · [R] turn · [X] into the back'
          : `Can't go there - ${lastCheck.reasons[0]}`;
      }
      const decor = decorUnderAim();
      if (decor) return `${decor.spec.displayName} - [E] move · [I] inventory · [Z] undo`;
      const f = fixtureUnderAim();
      return f
        ? `${f.title || f.kind} - [E] pick it up · [I] inventory`
        : 'Build mode - [I] property inventory · look at an item to move · [Z] undo · [B] stop';
    },

    update() {
      if (!active) return;
      if (inventoryOpen) {
        ghost.visible = false;
        halo.visible = false;
      } else if (decorCarry) {
        const pose = decorPose();
        lastCheck = validatePlaceablePlacement(state, decorCarry.skuId, pose, {
          exceptPlacementId: decorCarry.placementId,
        });
        ghost.position.set(pose.x, 0, pose.z);
        ghost.rotation.y = pose.ry;
        ghost.visible = true;
        setGhostColour(lastCheck.ok);
        halo.visible = false;
      } else if (carrying) {
        const p = aimLocal();
        lastCheck = validatePlacement(state, carrying, p.x, p.z, ry);
        ghost.position.set(p.x, 0, p.z);
        ghost.rotation.y = ry;
        setGhostColour(lastCheck.ok);
        halo.visible = false;
      } else {
        const decor = decorUnderAim();
        if (decor) {
          const r = placeableFootprint(decor.spec, decor.placement.pose);
          halo.visible = true;
          halo.position.set((r.minX + r.maxX) / 2, 0.03, (r.minZ + r.maxZ) / 2);
          const rad = Math.max(r.maxX - r.minX, r.maxZ - r.minZ) / 2 + 0.2;
          halo.scale.setScalar(rad / 0.12);
          return;
        }
        const f = fixtureUnderAim();
        if (f) {
          const r = fixtureRect(f);
          halo.visible = true;
          halo.position.set((r.minX + r.maxX) / 2, 0.03, (r.minZ + r.maxZ) / 2);
          const rad = Math.max(r.maxX - r.minX, r.maxZ - r.minZ) / 2 + 0.18;
          halo.scale.setScalar(rad);
        } else {
          halo.visible = false;
        }
      }
    },
  };
}

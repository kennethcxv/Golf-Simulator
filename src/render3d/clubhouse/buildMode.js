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
import {
  placedFixtures, validatePlacement, commitPlacement, storeFixture, GRID,
} from '../../sim/layout.js';

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
    fixtureAnchors,
    fixtureMoveBlocker = () => null,
    setFixtureStockVisible = () => {},
    setFixtureCollidersActive = () => {},
    fixtureColliderDiagnostics = () => null,
  } = deps;

  let active = false;
  let carrying = null; // fixture id
  let ry = 0;
  let lastCheck = { ok: false, reasons: [] };

  const ghost = new THREE.Group();
  ghost.visible = false;
  interior.add(ghost);

  const ghostMat = new THREE.MeshBasicMaterial({
    color: GHOST_OK, transparent: true, opacity: 0.34, depthWrite: false,
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: GHOST_OK, transparent: true, opacity: 0.9 });
  let ghostBox = null;
  let ghostEdges = null;
  let currentGhostProfile = null;

  // the highlight ring under whatever fixture you are looking at
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.1, 0.14, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd479, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.renderOrder = 998;
  halo.visible = false;
  interior.add(halo);

  function makeGhost(f) {
    if (ghostBox) {
      ghost.remove(ghostBox, ghostEdges);
      ghostBox.geometry.dispose();
      ghostEdges.geometry.dispose();
    }
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
    isCarrying: () => carrying,
    diagnostics() {
      const colliders = carrying ? fixtureColliderDiagnostics(carrying) : null;
      return Object.freeze({
        active,
        carrying,
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
      if (hooks.toast) hooks.toast('Build mode — look at a fixture and press [E] to pick it up. [B] to stop.');
    },

    exit() {
      if (carrying) this.cancel();
      active = false;
      ghost.visible = false;
      halo.visible = false;
    },

    // E: pick up what you are looking at, or put down what you are holding
    interact() {
      if (!active) return false;
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
        rebuildLayout();
        setFixtureCollidersActive(id, true);
        setFixtureStockVisible(id, true);
        if (hooks.sfx) hooks.sfx('thunk');
        if (hooks.toast) hooks.toast('Set down. The customers will find their way round it.');
        return true;
      }
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

    rotate() {
      if (!active || !carrying) return false;
      ry = (ry + Math.PI / 2) % (Math.PI * 2);
      return true;
    },

    // X: take it off the floor entirely
    stow() {
      if (!active || !carrying) return false;
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
      if (carrying) {
        return lastCheck.ok
          ? '[E] set it down · [R] turn · [X] into the back'
          : `Can't go there — ${lastCheck.reasons[0]}`;
      }
      const f = fixtureUnderAim();
      return f ? `${f.title || f.kind} — [E] pick it up` : 'Build mode — look at a fixture · [B] to stop';
    },

    update() {
      if (!active) return;
      if (carrying) {
        const p = aimLocal();
        lastCheck = validatePlacement(state, carrying, p.x, p.z, ry);
        ghost.position.set(p.x, 0, p.z);
        ghost.rotation.y = ry;
        setGhostColour(lastCheck.ok);
        halo.visible = false;
      } else {
        const f = fixtureUnderAim();
        if (f) {
          const r = fixtureRect(f);
          halo.visible = true;
          halo.position.set((r.minX + r.maxX) / 2, 0.03, (r.minZ + r.maxZ) / 2);
          const rad = Math.max(r.maxX - r.minX, r.maxZ - r.minZ) / 2 + 0.25;
          halo.scale.setScalar(rad / 0.12);
        } else {
          halo.visible = false;
        }
      }
    },
  };
}

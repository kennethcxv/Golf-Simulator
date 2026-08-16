// GOAL 30 LEVER B — FREEZE THE STATIC SET'S MATRICES.
//
// A standing frame recomputes ~9,150 local matrices (4,575 objects × the
// composer's two passes) with sim speed 0 and nothing moving. Every one of
// those objects whose transform is bit-stable can carry
// `matrixAutoUpdate = false` after one final authoritative updateMatrixWorld:
// updateMatrixWorld() still walks them, but skips the per-object
// compose-from-position/quaternion/scale, which is where the standing cost
// lives.
//
// WHAT MAY NEVER FREEZE — the same contracts the static batcher enforces,
// plus the movers a whole-tree walk can reach that the batcher (meshes only)
// never had to think about:
//   * anything under the batcher's exclusion flags: fixtureId / movable /
//     liveVisualHierarchy / visibilityGated / sim-item / proxy-or-helper,
//     ancestor animation clips, COL_/COLLISION_/VOLUME_ names, or the
//     caller's own exclude();
//   * characters (userData.char roots — their limbs re-pose every frame);
//   * door hardware (any userData key naming a door system — pivots rotate,
//     and overblocking a static jamb costs one matrix, while underblocking a
//     pivot freezes a door shut);
//   * cameras, lights and their targets (fitSunShadow OWNS sun.target),
//     bones and skinned meshes.
//
// UN-FREEZE: a frozen object that must move again gets unfreezeMatrices(sub).
// Only the moving subtree needs it — a frozen ANCESTOR's matrixWorld is valid
// and updateMatrixWorld still descends through it, so a re-enabled child
// composes against it correctly.
const COLLISION_PROXY_NAME = /^(?:COL_|COLLISION_|VOLUME_)/i;
const DOOR_KEY = /door/i;
const CONTROLLER_KEY = /controller/i; // the fridge's openingCoolerController animates a slab

function freezeBlocked(node, root, exclude, ignoreVisibilityGate) {
  for (let n = node; n; n = n.parent) {
    if (typeof exclude === 'function' && exclude(n)) return `excluded:${n.name || n.type}`;
    if (n.isCamera || n.isLight || n.isBone || n.isSkinnedMesh) return 'camera-light-or-rig';
    const u = n.userData;
    if (u) {
      if (u.fixtureId || u.movable) return 'movable-fixture';
      if (u.liveVisualHierarchy) return 'live-visual-hierarchy';
      // a caller that OWNS the gate may assert it only ever writes `visible`
      // (propPlacement's does — refreshVisibility touches no transform);
      // gating blocks by default because reveal hooks elsewhere also re-pose
      if (u.visibilityGated && !ignoreVisibilityGate) return 'visibility-gated';
      if (u.kind === 'item') return 'sim-item';
      if (u.collision_proxy || u.helper) return 'proxy-or-helper';
      if (u.char) return 'character';
      for (const key in u) if (DOOR_KEY.test(key) || CONTROLLER_KEY.test(key)) return 'door-or-controller-hardware';
    }
    if (n.animations?.length) return 'ancestor-animations';
    if (COLLISION_PROXY_NAME.test(n.name || '')) return 'collision-proxy-name';
    if (n === root) break;
  }
  return null;
}

/**
 * Freeze every bit-stable transform under root. Idempotent — safe to call
 * again after late arrivals land. Returns {frozen, skippedReasons}.
 */
export function freezeStaticMatrices(root, { exclude = null, label = 'MatrixFreeze', ignoreVisibilityGate = false } = {}) {
  if (!root) return { frozen: 0, skippedReasons: { 'no-root': 1 } };
  root.updateMatrixWorld(true); // the final authoritative pass before the set stops paying
  let frozen = 0;
  const skippedReasons = {};
  const skip = (reason) => { skippedReasons[reason] = (skippedReasons[reason] || 0) + 1; };
  root.traverse((object) => {
    if (object === root) return; // the root keeps ticking: owners move whole layers
    if (!object.matrixAutoUpdate) return;
    // cameras/lights/rigs and every contract flag, checked up the chain
    const blocked = freezeBlocked(object, root, exclude, ignoreVisibilityGate);
    if (blocked) return skip(blocked);
    object.matrixAutoUpdate = false;
    object.userData.matrixFrozen = label;
    frozen += 1;
  });
  return { frozen, skippedReasons };
}

/** Re-enable auto matrices for a subtree that must move again. */
export function unfreezeMatrices(object) {
  let thawed = 0;
  object?.traverse?.((o) => {
    if (o.userData?.matrixFrozen) {
      o.matrixAutoUpdate = true;
      delete o.userData.matrixFrozen;
      thawed += 1;
    }
  });
  return thawed;
}

// ---------------------------------------------------------------------------
// THE STABILITY FREEZE + WATCHDOG (Goal 30 Lever B, second stage).
//
// The live-movers census (qa/goal30/live-movers.json) measured an idle
// standing frame: of ~4,600 ticking objects, the movers are the camera
// subtree, the sun and its target, and the rain. Everything else is
// bit-stable — the goal doc's own criterion for the freeze. But bit-stable
// NOW is not a contract for later (doors swing, vans arrive), so every
// stability-frozen object is enrolled with a WATCHDOG: each frame a
// round-robin slice has its position/quaternion/scale compared against the
// values captured at freeze time; any write since then thaws the object
// permanently, at worst (listSize / perFrame) frames late — a one-time
// sub-200 ms pop on an unforeseen mover instead of a permanently stuck one.
// Contract movers (doors, controllers, fixtures, items, characters) are
// never enrolled in the first place, so the known gestures can never pop.
//
// Kill switch for A/B instrumentation: set `globalThis.__FW_DISABLE_STABILITY_FREEZE`
// before the scene builds and the arm call becomes a no-op.
const watchdog = {
  entries: [],   // { o, px,py,pz, qx,qy,qz,qw, sx,sy,sz }
  cursor: 0,
  thawed: 0,
  frozen: 0,
};

export function matrixFreezeSnapshot(scene) {
  const snap = new Map();
  scene.traverse((o) => { snap.set(o.uuid, o.matrixWorld.elements.join(',')); });
  return snap;
}

export function stabilityFreeze(scene, snapshot, { exclude = null, label = 'StabilityMatrixFreeze' } = {}) {
  if (globalThis.__FW_DISABLE_STABILITY_FREEZE) return { frozen: 0, disabled: true };
  let frozen = 0;
  const skippedReasons = {};
  const skip = (reason) => { skippedReasons[reason] = (skippedReasons[reason] || 0) + 1; };
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (o === scene) return;
    if (!o.matrixAutoUpdate) return;
    const before = snapshot.get(o.uuid);
    if (!before) return skip('born-after-snapshot');
    if (o.matrixWorld.elements.join(',') !== before) return skip('moved-since-snapshot');
    const blocked = freezeBlocked(o, scene, exclude, false);
    if (blocked) return skip(blocked);
    o.matrixAutoUpdate = false;
    o.userData.matrixFrozen = label;
    const p = o.position; const q = o.quaternion; const s = o.scale;
    watchdog.entries.push({
      o, px: p.x, py: p.y, pz: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, sx: s.x, sy: s.y, sz: s.z,
    });
    frozen += 1;
  });
  watchdog.frozen += frozen;
  return { frozen, skippedReasons };
}

/** One render-loop tick: verify a slice, thaw anything a verb moved. */
export function matrixFreezeWatchdogTick(perFrame = 400) {
  const list = watchdog.entries;
  if (!list.length) return;
  const n = Math.min(perFrame, list.length);
  for (let i = 0; i < n; i += 1) {
    if (watchdog.cursor >= list.length) watchdog.cursor = 0;
    const e = list[watchdog.cursor];
    const { o } = e;
    const p = o.position; const q = o.quaternion; const s = o.scale;
    if (p.x !== e.px || p.y !== e.py || p.z !== e.pz
      || q.x !== e.qx || q.y !== e.qy || q.z !== e.qz || q.w !== e.qw
      || s.x !== e.sx || s.y !== e.sy || s.z !== e.sz
      || !o.parent) {
      o.matrixAutoUpdate = true;
      if (o.userData) delete o.userData.matrixFrozen;
      list[watchdog.cursor] = list[list.length - 1];
      list.pop();
      watchdog.thawed += 1;
      continue; // the swapped-in entry gets checked on this same slot
    }
    watchdog.cursor += 1;
  }
}

/** Counters for instruments and the QA harness. */
export function matrixFreezeDiagnostics() {
  return {
    stabilityFrozen: watchdog.frozen,
    watchdogEnrolled: watchdog.entries.length,
    watchdogThawed: watchdog.thawed,
  };
}

/** Scene teardown: drop every enrollment so a rebuilt scene starts clean. */
export function matrixFreezeReset() {
  watchdog.entries.length = 0;
  watchdog.cursor = 0;
  watchdog.thawed = 0;
  watchdog.frozen = 0;
}

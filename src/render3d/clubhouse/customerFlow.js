// PURE CUSTOMER-CHECKOUT HELPERS.
//
// The Three.js customer renderer owns the meshes, but the rules that decide what an
// organic shopper means to buy and how many products can move onto the counter in a
// frame stay here. Keeping these helpers free of DOM/Three dependencies gives the
// normal-play path deterministic regression coverage without a debug-spawn shortcut.

export const ORGANIC_ORDER_MIN = 2;
export const ORGANIC_ORDER_MAX = 4;
export const PRODUCT_PLACE_SECONDS = 0.58;
export const CUSTOMER_IMPATIENT_BEAT_SECONDS = 1.25;

const rngInt = (rng, n) => (n > 0 && rng && typeof rng.int === 'function' ? rng.int(n) : 0);

export function organicOrderSize(rng) {
  return ORGANIC_ORDER_MIN + rngInt(rng, ORGANIC_ORDER_MAX - ORGANIC_ORDER_MIN + 1);
}

// Build a visit-by-visit shopping list from products that are physically on fixtures.
// Counts are consumed from a local copy while planning, so a shopper never plans four
// copies of a line that had only one on display. Distinct fixtures are preferred before
// revisiting a display, but a well-stocked single fixture can still supply a real order.
export function planOrganicOrder(fixtures, inventory, rng, wanted = organicOrderSize(rng)) {
  const target = Math.max(ORGANIC_ORDER_MIN, Math.min(ORGANIC_ORDER_MAX, Math.floor(wanted || 0)));
  const remaining = new Map();
  for (const f of fixtures || []) {
    for (const skuId of f.skus || []) {
      const shelf = Math.max(0, Math.floor((inventory && inventory[skuId] && inventory[skuId].shelf) || 0));
      if (!remaining.has(skuId)) remaining.set(skuId, shelf);
    }
  }

  const picks = [];
  const visited = new Set();
  while (picks.length < target) {
    const available = (fixtures || []).map((fixture, fixtureIndex) => ({
      fixture,
      fixtureIndex,
      skus: (fixture.skus || []).filter((skuId) => (remaining.get(skuId) || 0) > 0),
    })).filter((entry) => entry.skus.length > 0);
    if (!available.length) break;

    const fresh = available.filter((entry) => !visited.has(entry.fixtureIndex));
    const pool = fresh.length ? fresh : available;
    const choice = pool[rngInt(rng, pool.length)];
    const skuId = choice.skus[rngInt(rng, choice.skus.length)];
    remaining.set(skuId, remaining.get(skuId) - 1);
    visited.add(choice.fixtureIndex);
    picks.push({ fixture: choice.fixture, skuId });
  }

  // With fewer than two available units this is a browse-only visit. Do not turn a
  // stock shortage into the old one-item checkout path while multi-item checkout is
  // the authored normal-play experience.
  return picks.length >= ORGANIC_ORDER_MIN ? { target: picks.length, picks } : { target: 0, picks: [] };
}

// One cart uid owns exactly one visual. Calling this after every pickup is safe: it
// creates only missing meshes and removes only units that no longer belong to the
// shopper. A mesh may be parented to the customer OR to the counter while placement
// is in flight; the map remains the single source of visual identity either way.
export function reconcileCustomerItemMeshes(customer, { create, attach, detach }) {
  const meshes = customer.itemMeshes instanceof Map ? customer.itemMeshes : new Map();
  customer.itemMeshes = meshes;
  const desired = new Map();
  for (const item of customer.cart || []) {
    if (item && item.uid != null && !desired.has(item.uid)) desired.set(item.uid, item);
  }

  for (const [uid, mesh] of meshes) {
    if (desired.has(uid)) continue;
    if (detach) detach(mesh, uid);
    meshes.delete(uid);
  }
  for (const [uid, item] of desired) {
    if (meshes.has(uid)) continue;
    const mesh = create(item, uid);
    if (!mesh) continue;
    meshes.set(uid, mesh);
    if (attach) attach(mesh, item, uid);
  }
  return meshes;
}

export function createSequentialPlacement(items) {
  const seen = new Set();
  const uids = [];
  for (const item of items || []) {
    if (!item || item.uid == null || seen.has(item.uid)) continue;
    seen.add(item.uid);
    uids.push(item.uid);
  }
  return { uids, index: 0, activeUid: null, elapsed: 0, complete: uids.length === 0 };
}

// Rebuild a timed-out placement from durable item facts only. A placed flag is
// a checkpoint only when it has the authored counter pose that can restore its
// mesh; an interrupted item (placedAt assigned, placed still false) remains in
// the sequential work list. UID de-duplication matches the normal controller.
export function createSequentialPlacementRecovery(items) {
  const seen = new Set();
  const placedUids = [];
  const unplacedItems = [];
  for (const item of items || []) {
    if (!item || item.uid == null || seen.has(item.uid)) continue;
    seen.add(item.uid);
    if (item.placed === true && item.placedAt) placedUids.push(item.uid);
    else unplacedItems.push(item);
  }
  return {
    placedUids,
    unplacedUids: unplacedItems.map((item) => item.uid),
    placement: createSequentialPlacement(unplacedItems),
  };
}

// At most one product can start OR finish placement in one call. Even a long frame
// cannot teleport the rest of the order onto the counter behind the player's back.
export function stepSequentialPlacement(state, dt, duration = PRODUCT_PLACE_SECONDS) {
  if (!state || state.complete) return { complete: true, activeUid: null, progress: 1 };
  if (!state.activeUid) {
    state.activeUid = state.uids[state.index];
    state.elapsed = 0;
    return { started: state.activeUid, activeUid: state.activeUid, progress: 0, complete: false };
  }

  const seconds = Math.max(0.01, duration);
  state.elapsed = Math.min(seconds, state.elapsed + Math.max(0, Number(dt) || 0));
  const progress = state.elapsed / seconds;
  if (progress < 1) return { activeUid: state.activeUid, progress, complete: false };

  const placed = state.activeUid;
  state.index += 1;
  state.activeUid = null;
  state.elapsed = 0;
  state.complete = state.index >= state.uids.length;
  return { placed, activeUid: null, progress: 1, complete: state.complete };
}

// A customer who runs out of patience does not disappear into recovery on the
// threshold frame. This tiny visual-only state gives their restrained reaction a
// deterministic amount of screen time before clubhouse performs the existing
// inventory/register/queue cleanup. It deliberately owns no transaction data.
export function createCustomerImpatientBeat(duration = CUSTOMER_IMPATIENT_BEAT_SECONDS) {
  const requested = Number(duration);
  return {
    elapsed: 0,
    duration: Number.isFinite(requested) && requested > 0
      ? requested
      : CUSTOMER_IMPATIENT_BEAT_SECONDS,
    complete: false,
  };
}

export function stepCustomerImpatientBeat(state, dt) {
  if (!state || state.complete) return { complete: true, progress: 1 };
  state.elapsed = Math.min(state.duration, state.elapsed + Math.max(0, Number(dt) || 0));
  const progress = state.elapsed / state.duration;
  if (progress >= 1) state.complete = true;
  return { complete: state.complete, progress };
}

// Mirrors registerMode's counter layout so the detailed register-owned meshes can
// replace the customer's placement proxies without a visible jump.
export function checkoutStagingPose(index, count, staging, restY) {
  const n = Math.max(1, count || 1);
  const cols = Math.min(3, n);
  const cx = index % cols;
  const cz = Math.floor(index / cols);
  const x = staging.minX + 0.16 + cx * (((staging.maxX - staging.minX - 0.28) / Math.max(1, cols - 1)) || 0);
  const z = Math.min(staging.minZ + 0.10 + cz * 0.14, staging.maxZ - 0.06);
  return { x, y: restY, z, ry: (index * 0.7) % 1.2 - 0.6 };
}

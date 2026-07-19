// PERSISTENT CLEANING-TOOL LIFECYCLE.
//
// Dirt masks and debris already live in the save. This module owns the state that sits between
// the floor and disposal: a finite dustpan, one reusable trash bag, and the mop/bucket water
// cycle. Runtime-only things (which animation is half way through, particles, held buttons) do
// not belong here and are deliberately rebuilt when the scene loads.

import { clamp } from '../core/utils.js';

export const CLEANING_CAPACITY = Object.freeze({
  pan: 1.8,
  bag: 7.5,
  mopCharge: 24, // useful seconds per wring; long enough to clean a room without busywork
  bucketLevel: 1,
});

const round3 = (value) => Math.round(value * 1000) / 1000;
const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

function defaultState(legacyPan = 0, legacyBag = 0) {
  return {
    version: 1,
    pan: {
      load: round3(clamp(finite(legacyPan), 0, CLEANING_CAPACITY.pan)),
      capacity: CLEANING_CAPACITY.pan,
    },
    bag: {
      load: round3(clamp(finite(legacyBag), 0, CLEANING_CAPACITY.bag)),
      capacity: CLEANING_CAPACITY.bag,
      tied: false,
      disposed: 0,
      disposedLoad: 0,
    },
    mop: {
      charge: 0,
      capacity: CLEANING_CAPACITY.mopCharge,
      soil: 0,
    },
    bucket: {
      level: CLEANING_CAPACITY.bucketLevel,
      soil: 0,
      water: 'clean',
      wrings: 0,
      changes: 0,
    },
  };
}

function syncLegacy(reno, cleaning) {
  // These aliases shipped first and are read by a few older diagnostics. Keep them exact so old
  // code and old saves remain compatible while all new gameplay uses the structured contract.
  reno.pan = cleaning.pan.load;
  reno.bag = cleaning.bag.load;
}

/** Repair a new, legacy, partial, or corrupt cleaning lifecycle in place. */
export function ensureCleaningToolState(state) {
  const reno = state?.shop?.reno;
  if (!reno) return null;
  if (!reno.cleaning || typeof reno.cleaning !== 'object' || Array.isArray(reno.cleaning)) {
    reno.cleaning = defaultState(reno.pan, reno.bag);
  }
  const c = reno.cleaning;
  c.version = 1;

  if (!c.pan || typeof c.pan !== 'object') c.pan = {};
  c.pan.capacity = CLEANING_CAPACITY.pan;
  c.pan.load = round3(clamp(finite(c.pan.load, finite(reno.pan)), 0, c.pan.capacity));

  if (!c.bag || typeof c.bag !== 'object') c.bag = {};
  c.bag.capacity = CLEANING_CAPACITY.bag;
  c.bag.load = round3(clamp(finite(c.bag.load, finite(reno.bag)), 0, c.bag.capacity));
  c.bag.tied = !!c.bag.tied && c.bag.load > 0;
  c.bag.disposed = Math.max(0, Math.floor(finite(c.bag.disposed)));
  c.bag.disposedLoad = round3(Math.max(0, finite(c.bag.disposedLoad)));

  if (!c.mop || typeof c.mop !== 'object') c.mop = {};
  c.mop.capacity = CLEANING_CAPACITY.mopCharge;
  c.mop.charge = round3(clamp(finite(c.mop.charge), 0, c.mop.capacity));
  c.mop.soil = round3(clamp(finite(c.mop.soil), 0, 1));

  if (!c.bucket || typeof c.bucket !== 'object') c.bucket = {};
  c.bucket.level = round3(clamp(finite(c.bucket.level, 1), 0, 1));
  c.bucket.soil = round3(clamp(finite(c.bucket.soil), 0, 1));
  c.bucket.water = c.bucket.level <= 0
    ? 'empty'
    : (c.bucket.soil >= 0.68 || c.bucket.water === 'dirty' ? 'dirty' : 'clean');
  c.bucket.wrings = Math.max(0, Math.floor(finite(c.bucket.wrings)));
  c.bucket.changes = Math.max(0, Math.floor(finite(c.bucket.changes)));

  syncLegacy(reno, c);
  return c;
}

function acceptInto(container, amount) {
  const wanted = Math.max(0, finite(amount));
  const room = Math.max(0, container.capacity - container.load);
  const accepted = round3(Math.min(wanted, room));
  container.load = round3(container.load + accepted);
  return {
    accepted,
    remainder: round3(Math.max(0, wanted - accepted)),
    full: container.load >= container.capacity - 0.0005,
  };
}

export function panSpace(state) {
  const c = ensureCleaningToolState(state);
  return c ? round3(Math.max(0, c.pan.capacity - c.pan.load)) : 0;
}

export function bagSpace(state) {
  const c = ensureCleaningToolState(state);
  return c && !c.bag.tied ? round3(Math.max(0, c.bag.capacity - c.bag.load)) : 0;
}

export function addToPan(state, amount) {
  const c = ensureCleaningToolState(state);
  if (!c) return { accepted: 0, remainder: Math.max(0, finite(amount)), full: true };
  const result = acceptInto(c.pan, amount);
  syncLegacy(state.shop.reno, c);
  return result;
}

export function addToBag(state, amount) {
  const c = ensureCleaningToolState(state);
  if (!c || c.bag.tied) {
    return { accepted: 0, remainder: Math.max(0, finite(amount)), full: !!c, tied: !!c?.bag.tied };
  }
  const result = acceptInto(c.bag, amount);
  syncLegacy(state.shop.reno, c);
  return { ...result, tied: false };
}

/** Empty as much of the pan as the open bag can take. Nothing is silently deleted. */
export function emptyPanIntoBag(state) {
  const c = ensureCleaningToolState(state);
  if (!c) return { moved: 0, left: 0, reason: 'unavailable' };
  if (c.bag.tied) return { moved: 0, left: c.pan.load, reason: 'bag-tied' };
  if (c.pan.load <= 0) return { moved: 0, left: 0, reason: 'pan-empty' };
  const result = acceptInto(c.bag, c.pan.load);
  c.pan.load = round3(c.pan.load - result.accepted);
  syncLegacy(state.shop.reno, c);
  return {
    moved: result.accepted,
    left: c.pan.load,
    bagFull: result.full,
    reason: result.accepted > 0 ? null : 'bag-full',
  };
}

export function tieBag(state) {
  const c = ensureCleaningToolState(state);
  if (!c) return { ok: false, reason: 'unavailable' };
  if (c.bag.tied) return { ok: false, reason: 'already-tied', load: c.bag.load };
  if (c.bag.load <= 0) return { ok: false, reason: 'bag-empty', load: 0 };
  c.bag.tied = true;
  return { ok: true, load: c.bag.load };
}

/** Disposal is legal only after tying; it installs a fresh empty bag in the holder. */
export function disposeTiedBag(state) {
  const c = ensureCleaningToolState(state);
  if (!c) return { ok: false, reason: 'unavailable' };
  if (!c.bag.tied) return { ok: false, reason: c.bag.load > 0 ? 'not-tied' : 'bag-empty' };
  const disposed = c.bag.load;
  c.bag.load = 0;
  c.bag.tied = false;
  c.bag.disposed += 1;
  c.bag.disposedLoad = round3(c.bag.disposedLoad + disposed);
  syncLegacy(state.shop.reno, c);
  return { ok: true, disposed, count: c.bag.disposed };
}

/** One forgiving insert-and-wring service. The bucket gets dirtier rather than blocking work. */
export function serviceMop(state) {
  const c = ensureCleaningToolState(state);
  if (!c) return { ok: false, reason: 'unavailable' };
  if (c.bucket.level <= 0.02) return { ok: false, reason: 'bucket-empty' };
  const dirtyPenalty = c.bucket.water === 'dirty' ? 0.78 : 1;
  c.mop.charge = round3(c.mop.capacity * dirtyPenalty);
  c.mop.soil = round3(c.mop.soil * 0.22 + c.bucket.soil * 0.18);
  c.bucket.level = round3(Math.max(0, c.bucket.level - 0.055));
  c.bucket.soil = round3(clamp(c.bucket.soil + 0.12 + c.mop.soil * 0.12, 0, 1));
  c.bucket.wrings += 1;
  if (c.bucket.level <= 0.02) c.bucket.water = 'empty';
  else if (c.bucket.soil >= 0.68) c.bucket.water = 'dirty';
  return { ok: true, charge: c.mop.charge, water: c.bucket.water, level: c.bucket.level };
}

export function changeBucketWater(state) {
  const c = ensureCleaningToolState(state);
  if (!c) return { ok: false, reason: 'unavailable' };
  c.bucket.level = 1;
  c.bucket.soil = 0;
  c.bucket.water = 'clean';
  c.bucket.changes += 1;
  return { ok: true, changes: c.bucket.changes };
}

/** Spend mop charge only while a real floor stroke is accepted. */
export function consumeMopCharge(state, dtSec, cleaningStrength = 1) {
  const c = ensureCleaningToolState(state);
  if (!c) return { used: 0, charge: 0, dry: true, efficacy: 0 };
  if (c.mop.charge <= 0) return { used: 0, charge: 0, dry: true, efficacy: 0 };
  const used = Math.min(c.mop.charge, Math.max(0, finite(dtSec)));
  c.mop.charge = round3(Math.max(0, c.mop.charge - used));
  c.mop.soil = round3(clamp(c.mop.soil + used * 0.004 * Math.max(0, cleaningStrength), 0, 1));
  return {
    used: round3(used),
    charge: c.mop.charge,
    dry: c.mop.charge <= 0,
    efficacy: clamp(1 - c.mop.soil * 0.38, 0.55, 1),
  };
}

export function cleaningStatus(state) {
  const c = ensureCleaningToolState(state);
  if (!c) return null;
  return {
    pan: { ...c.pan, full: c.pan.load >= c.pan.capacity - 0.0005 },
    bag: { ...c.bag, full: c.bag.load >= c.bag.capacity - 0.0005 },
    mop: { ...c.mop, wet: c.mop.charge > 0 },
    bucket: { ...c.bucket },
  };
}

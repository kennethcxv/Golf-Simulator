import { boxDims } from './boxes.js';
import { STOCKROOM } from './shopLayout.js';

// Ref 44 is a 1.20 x 1.00 x 0.14 m block pallet. Five pallets form two staggered
// rows on a compact rectangular receiving apron. Each row has its own open fork-
// entry side and visible separation between pallets; with the nine-carton
// gameplay capacity no pallet ever needs more than two cartons.
export const DELIVERY_PALLET_STAGING = Object.freeze({
  model: 'delivery_wooden_pallet',
  count: 5,
  length: 1.20,
  width: 1.00,
  height: 0.14,
  maxBoxesPerPallet: 2,
  maxStackTop: 2.30,
  maxFootprintOverhang: 0.026,
  receivingApron: Object.freeze({ length: 4.30, width: 2.70, depth: 0.08 }),
  offsets: Object.freeze([
    Object.freeze({ x: -1.35, z: 0.62 }),
    Object.freeze({ x: 0.00, z: 0.62 }),
    Object.freeze({ x: 1.35, z: 0.62 }),
    Object.freeze({ x: -0.675, z: -0.67 }),
    Object.freeze({ x: 0.675, z: -0.67 }),
  ]),
  stackGap: 0.004,
});

// A sealed procedural carton carries a 12 mm tape crown above its nominal body.
// The three authored ref-46/47/48 families have measured production envelopes
// instead. Pad cartons cannot be opened in place, so these stable sealed heights
// are the physical support surfaces the pallet planner must use.
const AUTHORED_SEALED_HEIGHTS = Object.freeze({
  merchbox: 0.405,
  apparel: 0.366,
  clubbox: 0.180,
});

export function sealedDeliveryBoxHeight(kind) {
  const id = typeof kind === 'string' ? kind : kind?.id;
  return AUTHORED_SEALED_HEIGHTS[id] ?? boxDims(kind).h + 0.012;
}

function isPalletIndex(value) {
  return Number.isInteger(value)
    && value >= 0
    && value < DELIVERY_PALLET_STAGING.count;
}

export function deliveryPalletIndexForBox(box, fallbackIndex = 0) {
  if (isPalletIndex(box?.padPalletIndex)) return box.padPalletIndex;
  const fallback = Number.isFinite(fallbackIndex) ? Math.trunc(fallbackIndex) : 0;
  return ((fallback % DELIVERY_PALLET_STAGING.count)
    + DELIVERY_PALLET_STAGING.count) % DELIVERY_PALLET_STAGING.count;
}

export function deliveryBoxFitsPallet(kind) {
  const dimensions = boxDims(kind);
  const spec = DELIVERY_PALLET_STAGING;
  const allowance = spec.maxFootprintOverhang * 2;
  return (dimensions.w <= spec.length + allowance && dimensions.d <= spec.width + allowance)
    || (dimensions.d <= spec.length + allowance && dimensions.w <= spec.width + allowance);
}

function supportPose(lower, upper) {
  const base = boxDims(lower?.box ?? lower);
  const top = boxDims(upper?.box ?? upper);
  const allowance = DELIVERY_PALLET_STAGING.maxFootprintOverhang * 2;
  if (top.w <= base.w + allowance && top.d <= base.d + allowance) {
    return { supported: true, quarterTurns: 0 };
  }
  if (top.d <= base.w + allowance && top.w <= base.d + allowance) {
    return { supported: true, quarterTurns: 1 };
  }
  return { supported: false, quarterTurns: 0 };
}

function isSealedStackable(box) {
  const flaps = box?.flapProgress || box?.flaps || [];
  return !box?.flat
    && (box?.cutProgress ?? box?.tape ?? 0) <= 0
    && !flaps.some((value) => Number(value) > 0);
}

function laneSummary(boxes) {
  const spec = DELIVERY_PALLET_STAGING;
  const lanes = Array.from({ length: spec.count }, (_, palletIndex) => ({
    palletIndex,
    count: 0,
    nextBaseY: spec.height,
  }));
  for (const box of boxes) {
    if (!isPalletIndex(box?.padPalletIndex)) continue;
    const lane = lanes[box.padPalletIndex];
    lane.count += 1;
    lane.nextBaseY += sealedDeliveryBoxHeight(box?.box) + spec.stackGap;
  }
  return lanes;
}

function assignmentsAreSafe(boxes) {
  const spec = DELIVERY_PALLET_STAGING;
  // Old builds could force-land more than PAD_CAPACITY. Preserve those boxes in
  // deterministic overflow lanes until the player clears them; new arrivals are
  // blocked by the simulation and never create this flag.
  if (boxes.some((box) => box?.padStagingOverflow)) {
    return boxes.every((box) => isPalletIndex(box?.padPalletIndex));
  }
  const assigned = boxes.filter((box) => isPalletIndex(box?.padPalletIndex));
  const lanes = laneSummary(assigned);
  return lanes.every((lane) => lane.count <= spec.maxBoxesPerPallet
    && lane.nextBaseY - spec.stackGap <= spec.maxStackTop)
    && lanes.every((lane) => {
      const pair = boxes.filter((box) => box.padPalletIndex === lane.palletIndex);
      if (pair.length < 2) return true;
      const ordered = [...pair].sort(safeStackOrder);
      return isSealedStackable(ordered[0])
        && isSealedStackable(ordered[1])
        && supportPose(ordered[0], ordered[1]).supported;
    });
}

function canSharePallet(a, b) {
  if (!isSealedStackable(a) || !isSealedStackable(b)) return false;
  const ordered = [a, b].sort(safeStackOrder);
  return supportPose(ordered[0], ordered[1]).supported;
}

function groupingSignature(groups) {
  return groups.map((group) => group.map((box) => String(stableId(box))).sort().join('+')).join('|');
}

function balancedGroups(boxes) {
  const targetPairs = Math.min(
    Math.floor(boxes.length / 2),
    Math.max(0, boxes.length - DELIVERY_PALLET_STAGING.count),
  );
  const solve = (remaining) => {
    if (!remaining.length) return { pairs: 0, groups: [] };
    const [first, ...tail] = remaining;
    const options = [];
    const single = solve(tail);
    options.push({ pairs: single.pairs, groups: [[first], ...single.groups] });
    for (let index = 0; index < tail.length; index += 1) {
      if (!canSharePallet(first, tail[index])) continue;
      const rest = tail.filter((_, restIndex) => restIndex !== index);
      const paired = solve(rest);
      options.push({
        pairs: paired.pairs + 1,
        groups: [[first, tail[index]], ...paired.groups],
      });
    }
    options.sort((a, b) => {
      const aMeets = a.pairs >= targetPairs;
      const bMeets = b.pairs >= targetPairs;
      if (aMeets !== bMeets) return aMeets ? -1 : 1;
      if (a.pairs !== b.pairs) return aMeets ? a.pairs - b.pairs : b.pairs - a.pairs;
      return groupingSignature(a.groups).localeCompare(groupingSignature(b.groups));
    });
    return options[0];
  };
  return solve(boxes).groups;
}

function applyBalancedAssignments(padBoxes) {
  const safeCapacity = DELIVERY_PALLET_STAGING.count
    * DELIVERY_PALLET_STAGING.maxBoxesPerPallet;
  const groups = [
    ...balancedGroups(padBoxes.slice(0, safeCapacity)),
    ...padBoxes.slice(safeCapacity).map((box) => [box]),
  ];
  const laneCounts = Array.from({ length: DELIVERY_PALLET_STAGING.count }, () => 0);
  groups.forEach((group, groupIndex) => {
    const palletIndex = groupIndex < DELIVERY_PALLET_STAGING.count
      ? groupIndex
      : laneCounts.indexOf(Math.min(...laneCounts));
    const overflow = groupIndex >= DELIVERY_PALLET_STAGING.count;
    for (const box of group) {
      box.padPalletIndex = palletIndex;
      if (overflow) box.padStagingOverflow = true;
    }
    laneCounts[palletIndex] += group.length;
  });
}

// Persisted assignment is made by the simulation at arrival/load time. It uses
// compatible two-box groups plus least-loaded open lanes rather than box-id
// modulo: sparse ids cannot create a tower, and a narrow long carton is never
// asked to support a wider case. Existing safe assignments never move.
export function assignDeliveryPallets(boxes, { rebalance = false } = {}) {
  const padBoxes = (boxes || []).filter((box) => !box?.loc || box.loc === 'pad');
  if (rebalance || !assignmentsAreSafe(padBoxes)
    || (padBoxes.length > 0 && padBoxes.every((box) => !isPalletIndex(box.padPalletIndex)))) {
    for (const box of padBoxes) {
      delete box.padPalletIndex;
      delete box.padStagingOverflow;
    }
    applyBalancedAssignments(padBoxes);
    return padBoxes;
  }

  for (const box of padBoxes) {
    if (isPalletIndex(box.padPalletIndex)) continue;
    const lanes = laneSummary(padBoxes);
    const boxHeight = sealedDeliveryBoxHeight(box?.box);
    const supported = deliveryBoxFitsPallet(box?.box);
    const eligible = lanes.filter((lane) => {
      const existing = padBoxes.filter((entry) => entry.padPalletIndex === lane.palletIndex);
      return supported
      && lane.count < DELIVERY_PALLET_STAGING.maxBoxesPerPallet
      && lane.nextBaseY + boxHeight <= DELIVERY_PALLET_STAGING.maxStackTop
      && (existing.length === 0 || canSharePallet(existing[0], box));
    });
    if (!eligible.length && padBoxes.length <= DELIVERY_PALLET_STAGING.count * 2) {
      for (const entry of padBoxes) {
        delete entry.padPalletIndex;
        delete entry.padStagingOverflow;
      }
      applyBalancedAssignments(padBoxes);
      return padBoxes;
    }
    const choices = eligible.length ? eligible : lanes;
    choices.sort((a, b) => a.count - b.count
      || a.nextBaseY - b.nextBaseY
      || a.palletIndex - b.palletIndex);
    box.padPalletIndex = choices[0].palletIndex;
    if (!eligible.length) box.padStagingOverflow = true;
  }
  return padBoxes;
}

export function deliveryPalletCentres() {
  const spec = DELIVERY_PALLET_STAGING;
  return Array.from({ length: spec.count }, (_, index) => ({
    palletIndex: index,
    x: STOCKROOM.padOutside.x + spec.offsets[index].x,
    z: STOCKROOM.padOutside.z + spec.offsets[index].z,
    ry: 0,
  }));
}

function stableId(box) {
  const numeric = Number(box?.id);
  return Number.isSafeInteger(numeric) ? numeric : String(box?.id ?? '');
}

// Long, wide and heavy cartons form the support layer. Fragile cartons are
// always last (top), then smaller/lighter boxes. The final id comparison keeps
// the plan byte-stable across save/load.
function safeStackOrder(a, b) {
  if (!!a.fragile !== !!b.fragile) return a.fragile ? 1 : -1;
  const ad = boxDims(a?.box);
  const bd = boxDims(b?.box);
  const span = Math.max(bd.w, bd.d) - Math.max(ad.w, ad.d);
  if (Math.abs(span) > 1e-9) return span;
  const area = (bd.w * bd.d) - (ad.w * ad.d);
  if (Math.abs(area) > 1e-9) return area;
  const weight = (Number(b?.lb) || 0) - (Number(a?.lb) || 0);
  if (Math.abs(weight) > 1e-9) return weight;
  const ai = stableId(a);
  const bi = stableId(b);
  return typeof ai === 'number' && typeof bi === 'number'
    ? ai - bi : String(ai).localeCompare(String(bi));
}

// Cartons remain ordinary persisted delivery boxes. Planning works on copies so
// rendering can never mutate game/save state; the simulation normally supplies
// persisted padPalletIndex values, while the copy-only assignment is a safe
// preload/legacy fallback.
export function planPalletizedPadBoxes(boxes, { palletHeight = DELIVERY_PALLET_STAGING.height } = {}) {
  const centres = deliveryPalletCentres();
  const staging = (boxes || []).map((box) => ({ ...box }));
  assignDeliveryPallets(staging);
  const byPallet = centres.map(() => []);
  for (const box of staging) byPallet[deliveryPalletIndexForBox(box)].push(box);

  const plans = [];
  for (const centre of centres) {
    let baseY = palletHeight;
    const lane = byPallet[centre.palletIndex].sort(safeStackOrder);
    for (let laneIndex = 0; laneIndex < lane.length; laneIndex += 1) {
      const box = lane[laneIndex];
      const dimensions = boxDims(box?.box);
      const stackHeight = sealedDeliveryBoxHeight(box?.box);
      const below = laneIndex > 0 ? lane[laneIndex - 1] : null;
      const pose = below ? supportPose(below, box) : { supported: true, quarterTurns: 0 };
      plans.push({
        boxId: box?.id,
        palletIndex: centre.palletIndex,
        x: centre.x,
        z: centre.z,
        ry: centre.ry + pose.quarterTurns * Math.PI / 2,
        baseY,
        dimensions,
        stackHeight,
        footprintSupported: deliveryBoxFitsPallet(box?.box) && pose.supported,
      });
      baseY += stackHeight + DELIVERY_PALLET_STAGING.stackGap;
    }
  }
  return plans;
}

export function exposedDeliveryPadBoxIds(boxes) {
  const topByPallet = new Map();
  for (const plan of planPalletizedPadBoxes(boxes)) {
    topByPallet.set(plan.palletIndex, plan.boxId);
  }
  return new Set(topByPallet.values());
}

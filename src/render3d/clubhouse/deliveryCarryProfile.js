import { boxDims } from '../../data/boxes.js';

// Camera-local presentation profiles for real-scale delivery packages.  These
// are deliberately data-only: the renderer, hands, QA probes, and tests all
// consume the same pose instead of growing another family-specific switch.
// Positions look down camera -Z; the front face clearance is therefore what
// keeps tall and freight cartons out of the near plane.
const PROFILE_BY_KIND = Object.freeze({
  carton: 'small-chest',
  ballcase: 'small-chest',
  shoebox: 'small-chest',
  provisions: 'small-chest',
  merchbox: 'medium-two-hand',
  apparel: 'medium-two-hand',
  fixture: 'medium-two-hand',
  bagcarton: 'tall-bulky',
  crate: 'freight-low-far',
  clubbox: 'long-two-hand-diagonal',
  umbrella: 'long-two-hand-diagonal',
  ironset: 'long-two-hand-diagonal',
});

const POSE_BY_PROFILE = Object.freeze({
  'small-chest': Object.freeze({
    // Keep the label clear of the bottom HUD: compact cartons sit slightly
    // higher and farther out than the original cropped first-person pose.
    position: Object.freeze([0, -0.60, -1.38]),
    rotation: Object.freeze([-0.04, 0.08, 0]),
  }),
  'medium-two-hand': Object.freeze({
    position: Object.freeze([0, -0.74, -1.42]),
    rotation: Object.freeze([-0.04, 0.08, 0]),
  }),
  'tall-bulky': Object.freeze({
    position: Object.freeze([0, -0.92, -1.82]),
    rotation: Object.freeze([-0.03, 0.12, 0]),
  }),
  'freight-low-far': Object.freeze({
    position: Object.freeze([0, -1.02, -2.15]),
    rotation: Object.freeze([-0.02, 0.05, 0]),
  }),
  // This is the already accepted club-carton route pose. Keep it exact.
  'long-two-hand-diagonal': Object.freeze({
    position: Object.freeze([0, -0.58, -1.30]),
    rotation: Object.freeze([0.02, 0.78, -0.16]),
  }),
});

function packageKindId(boxOrKind) {
  if (typeof boxOrKind === 'string') return boxOrKind;
  if (boxOrKind && typeof boxOrKind.box === 'string') return boxOrKind.box;
  return 'carton';
}

function flatProfile(kind, dimensions) {
  const long = ['clubbox', 'umbrella', 'ironset'].includes(kind);
  return {
    id: long ? 'flat-long' : 'flat-standard',
    kind,
    dimensions,
    position: [0, long ? -0.28 : -0.34, long ? -1.28 : -1.18],
    rotation: [1.12, 0.08, long ? -0.14 : 0],
    hands: {
      supportX: dimensions.w * (long ? 0.34 : 0.40),
      y: -0.31,
      ySkew: long ? -0.055 : 0,
      z: -0.91,
      zSkew: 0,
      rotationX: -0.42,
      rotationY: 0.10,
      rotationZ: long ? -0.30 : -0.20,
    },
  };
}

export function deliveryBoxCarryProfile(boxOrKind) {
  const kind = packageKindId(boxOrKind);
  const dimensions = boxDims(kind);
  if (boxOrKind && typeof boxOrKind === 'object' && boxOrKind.flat) {
    return flatProfile(kind, dimensions);
  }

  // Unknown legacy packaging remains safely carryable with the conservative
  // medium pose; every current production BOX_KINDS entry is mapped above and
  // asserted by tests.
  const id = PROFILE_BY_KIND[kind] || 'medium-two-hand';
  const pose = POSE_BY_PROFILE[id];
  const long = id === 'long-two-hand-diagonal';
  const freight = id === 'freight-low-far';
  const supportX = long
    ? dimensions.w * 0.19
    : Math.min(dimensions.w * 0.5 + 0.018, freight ? 0.50 : 0.44);
  const handY = long ? -0.49 : pose.position[1] + (freight ? 0.16 : 0.14);
  const handZ = long ? -1.30 : pose.position[2] + dimensions.d * 0.5 + 0.04;

  return {
    id,
    kind,
    dimensions,
    position: [...pose.position],
    rotation: [...pose.rotation],
    hands: {
      supportX,
      y: handY,
      ySkew: long ? -0.050 : 0,
      z: handZ,
      zSkew: long ? -0.24 : 0,
      rotationX: long ? -0.22 : -0.16,
      rotationY: long ? 0.08 : 0.12,
      rotationZ: long ? -0.34 : -0.24,
    },
  };
}

export const DELIVERY_BOX_CARRY_PROFILE_BY_KIND = PROFILE_BY_KIND;

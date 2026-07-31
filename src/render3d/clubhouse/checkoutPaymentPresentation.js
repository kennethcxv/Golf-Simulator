import * as THREE from 'three';
import { FRONT_DESK_FRAME, frontDeskVector } from '../../data/shopLayout.js';

const asPoint = (value = {}) => ({
  x: Number(value.x) || 0,
  y: Number(value.y) || 0,
  z: Number(value.z) || 0,
});

const isBill = (denom) => Number(denom) >= 1;
const FRONT_DESK_QUATERNION = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  FRONT_DESK_FRAME.ry,
);

function offsetInFrontDeskFrame(point, localX = 0, localY = 0, localZ = 0) {
  const offset = frontDeskVector(localX, localZ);
  return {
    x: point.x + offset.x,
    y: point.y + localY,
    z: point.z + offset.z,
  };
}

function frontDeskRotation(localPitch = 0, localYaw = 0, localRoll = 0) {
  if (localPitch === 0 && localRoll === 0) {
    return { x: 0, y: FRONT_DESK_FRAME.ry + localYaw, z: 0 };
  }
  const local = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(localPitch, localYaw, localRoll),
  );
  const rotation = new THREE.Euler().setFromQuaternion(
    FRONT_DESK_QUATERNION.clone().multiply(local),
    'XYZ',
  );
  return { x: rotation.x, y: rotation.y, z: rotation.z };
}

// Customer props use the articulated carry grip as contact, then offset just
// enough for the fingers to pinch an edge instead of occupying the prop centre.
export function customerCardPoint(hand) {
  const point = asPoint(hand);
  return offsetInFrontDeskFrame(point, -0.030, 0.018, 0.028);
}

export function customerCashPoint(hand) {
  const point = asPoint(hand);
  return offsetInFrontDeskFrame(point, -0.024, 0.026, 0.028);
}

// The customer LAYS their money ON THE COUNTER (round 7: "make it so the
// money goes on the desk", matching the round-5 reference note "look at the
// cash on the table"): notes rest flat in a loose readable fan in front of
// them, coins flat at the fan's near edge. The old held-up handful floated at
// the grip and could only ever read as one blob in the air. The anchor is a
// point ON the counter top; y climbs only paper thickness per overlap.
export function presentedTenderLayout(denominations = [], anchor = {}) {
  const origin = asPoint(anchor);
  let billIndex = 0;
  let coinIndex = 0;
  return denominations.map((rawDenom) => {
    const denom = Number(rawDenom);
    if (isBill(denom)) {
      const index = billIndex++;
      return {
        denom,
        position: offsetInFrontDeskFrame(
          origin,
          -0.078 + index * 0.052,
          0.0016 + index * 0.0016,
          index % 2 ? 0.018 : -0.010,
        ),
        rotation: frontDeskRotation(0, -0.10 + ((index % 3) - 1) * 0.14, 0),
      };
    }
    const index = coinIndex++;
    return {
      denom,
      position: offsetInFrontDeskFrame(
        origin,
        -0.050 + (index % 3) * 0.033,
        0.0022 + Math.floor(index / 3) * 0.0032,
        0.060 + Math.floor(index / 3) * 0.028,
      ),
      rotation: frontDeskRotation(0, 0, (index % 3 - 1) * 0.07),
    };
  });
}

// Counted change accumulates as a FLAT PILE directly on the BARE counter —
// the TCG reference look (Designs/CashRegister/Final, 154641): notes lie flat
// in a loosely fanned overlap, coins rest flat beside them. The authored
// handoff tray prop was deleted 2026-07-30; the handoff point now names bare
// counter surface left of the drawer.
export function selectedChangeLayout(denominations = [], handoff = {}, counterTop = 0) {
  const pile = asPoint(handoff);
  const counter = { x: pile.x, y: Number(counterTop), z: pile.z };
  let billIndex = 0;
  let coinIndex = 0;
  return denominations.map((rawDenom) => {
    const denom = Number(rawDenom);
    if (isBill(denom)) {
      const index = billIndex++;
      return {
        denom,
        // each note steps sideways so the pile reads as separate flat bills,
        // climbing only paper-thickness per overlap — never a floating stack
        position: offsetInFrontDeskFrame(
          counter,
          -0.105 + index * 0.034,
          0.0016 + index * 0.0016,
          -0.028 + (index % 2 ? 0.016 : -0.008),
        ),
        rotation: frontDeskRotation(0, 0.08 + ((index % 3) - 1) * 0.16, 0),
      };
    }
    const index = coinIndex++;
    return {
      denom,
      position: offsetInFrontDeskFrame(
        counter,
        0.052 + (index % 3) * 0.033,
        0.0022 + Math.floor(index / 3) * 0.0032,
        0.028 + Math.floor(index / 3) * 0.030,
      ),
      rotation: frontDeskRotation(0, 0, (index % 3 - 1) * 0.07),
    };
  });
}

// Once confirmed, every selected piece belongs to one physical handful. These
// are local offsets inside that desk-oriented carrier, allowing a single
// coherent handoff without applying the desk rotation twice.
export function changeBundleLayout(denominations = []) {
  let billIndex = 0;
  let coinIndex = 0;
  return denominations.map((rawDenom) => {
    const denom = Number(rawDenom);
    if (isBill(denom)) {
      const index = billIndex++;
      return {
        denom,
        position: { x: index * 0.006, y: index * 0.0015, z: index * 0.002 },
        rotation: { x: 0, y: index * 0.018, z: 0 },
      };
    }
    const index = coinIndex++;
    return {
      denom,
      position: {
        x: -0.018 + (index % 3) * 0.022,
        y: 0.010 + Math.floor(index / 3) * 0.003,
        z: 0.034 + Math.floor(index / 3) * 0.017,
      },
      rotation: { x: 0, y: 0, z: (index % 3 - 1) * 0.08 },
    };
  });
}

export function changeHandoffPoint(hand) {
  const point = asPoint(hand);
  return offsetInFrontDeskFrame(point, -0.018, 0.025, 0.030);
}

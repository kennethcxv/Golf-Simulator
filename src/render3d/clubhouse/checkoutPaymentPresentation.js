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

// Incoming tender is one held handful. Notes overlap like a counted stack and
// coins sit along its near edge; neither is spread into a counter-sized fan.
export function presentedTenderLayout(denominations = [], hand = {}) {
  const origin = customerCashPoint(hand);
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
          index * 0.009,
          index * 0.0022,
          index * 0.002,
        ),
        rotation: frontDeskRotation(1.04, -0.05 + index * 0.025, 0),
      };
    }
    const index = coinIndex++;
    return {
      denom,
      position: offsetInFrontDeskFrame(
        origin,
        -0.018 + (index % 3) * 0.025,
        0.010 + Math.floor(index / 3) * 0.003,
        0.035 + Math.floor(index / 3) * 0.018,
      ),
      rotation: frontDeskRotation(0.92, 0, (index % 3 - 1) * 0.08),
    };
  });
}

// Counted change stays inside the 38 x 20 cm handoff tray. Notes form one tidy
// stack; coins form a small three-column count beside it.
export function selectedChangeLayout(denominations = [], handoff = {}, counterTop = 0) {
  const tray = asPoint(handoff);
  const trayTop = { x: tray.x, y: Number(counterTop), z: tray.z };
  let billIndex = 0;
  let coinIndex = 0;
  return denominations.map((rawDenom) => {
    const denom = Number(rawDenom);
    if (isBill(denom)) {
      const index = billIndex++;
      return {
        denom,
        position: offsetInFrontDeskFrame(
          trayTop,
          -0.078 + index * 0.006,
          0.020 + index * 0.0015,
          -0.020 + index * 0.002,
        ),
        rotation: frontDeskRotation(0, 0.10 + index * 0.018, 0),
      };
    }
    const index = coinIndex++;
    return {
      denom,
      position: offsetInFrontDeskFrame(
        trayTop,
        0.030 + (index % 3) * 0.032,
        0.024 + Math.floor(index / 3) * 0.003,
        -0.032 + Math.floor(index / 3) * 0.034,
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

// Stylised first-person cashier arms. The rig is intentionally small and procedural
// so it matches the existing first-person tool hands, but unlike a floating prop it
// solves each wrist toward a world-space interaction target every frame. Poses blend
// instead of snapping and cover every physical checkout verb.

import * as THREE from 'three';

const SKIN = 0xd9a97e;
const CUFF = 0x244b36;
const CUFF_EDGE = 0x78947c;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const PLACE_DIR = new THREE.Vector3();

// Like the production tool hands, checkout renders only the last part of the
// forearm. The wrist still reaches the exact world target; the short trailing
// viewmodel prevents counter depth from turning a normal gesture into a long tube.
const CUFF_EDGE_LENGTH = 0.032;
const VIEWMODEL_FOREARM = 0.19;
const VIEWMODEL_SLEEVE = 0.075;

export const CASHIER_POSES = {
  idle: { curl: 0.45, spread: 0.02 },
  reach: { curl: 0.18, spread: 0.05 },
  'pick-small': { curl: 0.72, spread: 0.01 },
  'pick-medium': { curl: 0.58, spread: 0.025 },
  rotate: { curl: 0.66, spread: 0.02 },
  scan: { curl: 0.64, spread: 0.02 },
  'place-item': { curl: 0.30, spread: 0.04 },
  'accept-bill': { curl: 0.26, spread: 0.04 },
  'accept-coin': { curl: 0.62, spread: 0.01 },
  'deposit-bill': { curl: 0.32, spread: 0.03 },
  'deposit-coin': { curl: 0.68, spread: 0.01 },
  'select-change': { curl: 0.48, spread: 0.02 },
  'hold-change': { curl: 0.72, spread: 0.005 },
  'give-change': { curl: 0.24, spread: 0.045 },
  'hold-card': { curl: 0.42, spread: 0.018 },
  'swipe-card': { curl: 0.56, spread: 0.012 },
  'collect-receipt': { curl: 0.35, spread: 0.025 },
  'open-bag': { curl: 0.28, spread: 0.05 },
  'bag-item': { curl: 0.48, spread: 0.02 },
  'add-receipt': { curl: 0.34, spread: 0.03 },
  'hand-bag': { curl: 0.70, spread: 0.008 },
};

function makeHand(side, skin) {
  const root = new THREE.Group();
  // A low-poly ellipsoid gives the palm a rounded heel and knuckles without the
  // hard, rectangular silhouette the old box produced around cards and handles.
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), skin);
  palm.scale.set(0.036, 0.0175, 0.0435);
  palm.position.z = -0.015;
  palm.castShadow = true;
  root.add(palm);

  // The wrist bridges the camera-facing palm orientation to the world-space
  // forearm endpoint, hiding small seams as the arm bends around a grip target.
  const wrist = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), skin);
  wrist.scale.set(0.024, 0.021, 0.029);
  wrist.position.z = 0.026;
  wrist.castShadow = true;
  root.add(wrist);

  const fingers = [];
  for (let i = 0; i < 4; i++) {
    // Keep enough fingertip area to read around cards and receipts, while avoiding
    // the oversized mitten silhouette that hid small checkout props.
    const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.0082, 0.043, 3, 7), skin);
    finger.rotation.x = Math.PI / 2;
    finger.position.set(side * (-0.025 + i * 0.017), -0.010, -0.066);
    finger.castShadow = true;
    root.add(finger);
    fingers.push(finger);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0105, 0.037, 3, 7), skin);
  thumb.position.set(side * 0.044, 0.002, -0.022);
  thumb.rotation.set(0.7, 0, -side * 0.62);
  thumb.castShadow = true;
  root.add(thumb);
  return { root, fingers, thumb };
}

function makeArm(side, mats) {
  const root = new THREE.Group();
  // Cylinder top is the wrist and bottom is the elbow for this placement order.
  // The stronger taper reads as a forearm instead of a uniform pipe.
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.032, 1, 12, 1, true), mats.skin);
  forearm.castShadow = true;
  root.add(forearm);
  const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.0365, 1, 12, 1, true), mats.skinOverlay);
  upperArm.castShadow = true;
  root.add(upperArm);
  // A Pinehollow polo is short-sleeved. Keeping the cuff near the camera edge and
  // articulating two skin segments gives the arm a readable elbow instead of one
  // long green tube running directly from the camera to every checkout prop.
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.046, 1, 12, 1, true), mats.cuff);
  sleeve.castShadow = true;
  root.add(sleeve);
  const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 9), mats.skin);
  elbowJoint.scale.set(1, 0.92, 0.96);
  elbowJoint.castShadow = true;
  root.add(elbowJoint);
  // A restrained sage rolled edge separates polo fabric from skin and covers the
  // conical junction, so the sleeve no longer pinches into the upper arm.
  const cuffEdge = new THREE.Mesh(new THREE.CylinderGeometry(0.0395, 0.0395, 1, 12, 1, true), mats.cuffEdge);
  cuffEdge.castShadow = true;
  root.add(cuffEdge);
  const hand = makeHand(side, mats.skin);
  root.add(hand.root);
  return {
    root, forearm, upperArm, sleeve, elbowJoint, cuffEdge, hand,
    wrist: new THREE.Vector3(),
    shownWrist: new THREE.Vector3(),
    shoulder: new THREE.Vector3(),
    cuff: new THREE.Vector3(),
    cuffEdgeEnd: new THREE.Vector3(),
    joint: new THREE.Vector3(),
    shown: 0,
    curl: 0.45,
  };
}

function placeCylinder(mesh, a, b, inset = 0) {
  PLACE_DIR.subVectors(b, a);
  const length = Math.max(0.001, PLACE_DIR.length() - inset);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, PLACE_DIR.normalize());
  mesh.scale.set(1, length, 1);
}

export function makeCashierHands(interior) {
  const mats = {
    // First-person limbs are a view model: the counter edge must not cut the
    // shoulder chain into floating stumps. Only the short polo sleeve overlays the
    // counter edge; skin keeps normal depth so elbows, wrists, and fingers retain
    // correct self-occlusion instead of exposing cylinder end caps.
    skin: new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.82 }),
    skinOverlay: new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.82, depthTest: false, depthWrite: false }),
    cuff: new THREE.MeshStandardMaterial({ color: CUFF, roughness: 0.9, depthTest: false, depthWrite: false }),
    cuffEdge: new THREE.MeshStandardMaterial({ color: CUFF_EDGE, roughness: 0.92, depthTest: false, depthWrite: false }),
  };
  const root = new THREE.Group();
  root.name = 'CashierHandsRig';
  interior.add(root);
  const right = makeArm(1, mats);
  const left = makeArm(-1, mats);
  right.root.name = 'CashierArm_R';
  left.root.name = 'CashierArm_L';
  root.add(right.root, left.root);
  right.sleeve.renderOrder = 100;
  left.sleeve.renderOrder = 100;
  right.upperArm.renderOrder = 99;
  left.upperArm.renderOrder = 99;
  right.cuffEdge.renderOrder = 101;
  left.cuffEdge.renderOrder = 101;
  root.visible = false;

  const camLocal = new THREE.Vector3();
  const elbow = new THREE.Vector3();
  const target = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const camForward = new THREE.Vector3();
  const camQuat = new THREE.Quaternion();
  let time = 0;

  function updateArm(arm, side, dt, requested, pose, visible) {
    // A one-handed verb must not leave a fully opaque limb hanging for several
    // frames at its previous target. The arm is hidden at the same interaction
    // boundary; targeted and neutral-idle arms still blend in normally.
    if (!visible) {
      arm.shown = 0;
      arm.root.visible = false;
      return;
    }
    arm.shown += ((visible ? 1 : 0) - arm.shown) * Math.min(1, dt * 10);

    if (requested) target.copy(requested);
    else target.copy(camLocal)
      .addScaledVector(camRight, side * 0.25)
      .addScaledVector(camUp, -0.24)
      .addScaledVector(camForward, 0.54);

    const breathe = Math.sin(time * 1.7 + side) * 0.004;
    target.y += breathe;
    if (arm.wrist.lengthSq() === 0) arm.wrist.copy(target);
    arm.wrist.lerp(target, 1 - Math.exp(-dt * 14));

    const retreat = (1 - arm.shown) * 0.42;
    const shownWrist = arm.shownWrist.copy(arm.wrist);
    shownWrist.y -= retreat;

    // Checkout uses the same short-viewmodel principle as the production tool
    // hands: exact fingers at the prop plus only the last 19 cm of forearm and a
    // 7.5 cm polo sleeve. Reconstructing the literal camera-to-customer arm made
    // a tan tube dominate the counter and is not how first-person viewmodels are
    // framed. The short trail points back toward the player and stays consistent
    // at the scanner, terminal, drawer, and customer handoff depths.
    const cuff = arm.cuff.copy(shownWrist)
      .addScaledVector(camForward, -VIEWMODEL_FOREARM)
      .addScaledVector(camUp, -0.045)
      .addScaledVector(camRight, side * 0.018);
    const shoulder = arm.shoulder.copy(cuff)
      .addScaledVector(camForward, -VIEWMODEL_SLEEVE)
      .addScaledVector(camUp, -0.020)
      .addScaledVector(camRight, side * 0.010);
    const cuffEdgeEnd = arm.cuffEdgeEnd.copy(cuff).lerp(shownWrist,
      Math.min(1, CUFF_EDGE_LENGTH / Math.max(cuff.distanceTo(shownWrist), 0.001)));
    placeCylinder(arm.sleeve, shoulder, cuff);
    placeCylinder(arm.forearm, cuff, shownWrist);
    placeCylinder(arm.cuffEdge, cuff, cuffEdgeEnd);
    // The longer two-segment anatomy remains available for idle-model tests and
    // future close poses, but production targeted verbs use the compact viewmodel.
    arm.upperArm.visible = false;
    arm.elbowJoint.visible = false;
    arm.hand.root.position.copy(shownWrist);
    arm.hand.root.quaternion.copy(camQuat);
    arm.hand.root.rotateX(-0.28);
    arm.hand.root.rotateY(side * 0.08);
    arm.hand.root.rotateZ(side * -0.16);

    // An untargeted arm remains in its own camera-safe idle pose while the other
    // hand works. This keeps both forearms attached to the player without making an
    // off-hand mirror a one-handed card, receipt, or cash gesture.
    const cfg = CASHIER_POSES[requested ? pose : 'idle'] || CASHIER_POSES.idle;
    arm.curl += (cfg.curl - arm.curl) * Math.min(1, dt * 14);
    for (let i = 0; i < arm.hand.fingers.length; i++) {
      const finger = arm.hand.fingers[i];
      finger.rotation.x = Math.PI / 2 + arm.curl * 0.92;
      finger.position.x += ((side * (-0.025 + i * 0.017) * (1 + cfg.spread)) - finger.position.x) * Math.min(1, dt * 12);
    }
    arm.hand.thumb.rotation.x = 0.55 + arm.curl * 0.55;
    arm.root.visible = arm.shown > 0.015;
  }

  return {
    root,
    update(dt, camera, { rightTarget = null, leftTarget = null, pose = 'idle', visible = false } = {}) {
      time += dt;
      // Two untargeted arms establish the neutral cashier stance. Once a physical
      // verb starts, render only hands with real grip targets; bag handoff and true
      // two-hand products still provide both targets. This prevents the unused hand
      // from becoming a detached cuff fragment behind the POS, scanner, or drawer.
      const idle = !rightTarget && !leftTarget;
      const showRight = visible && (idle || !!rightTarget);
      const showLeft = visible && (idle || !!leftTarget);
      if (!showRight && !showLeft && right.shown < 0.015 && left.shown < 0.015) {
        right.shown = 0;
        left.shown = 0;
        right.root.visible = false;
        left.root.visible = false;
        root.visible = false;
        return;
      }
      camera.getWorldQuaternion(camQuat);
      camLocal.copy(camera.position);
      interior.worldToLocal(camLocal);
      camRight.set(1, 0, 0).applyQuaternion(camQuat).normalize();
      camUp.set(0, 1, 0).applyQuaternion(camQuat).normalize();
      camera.getWorldDirection(camForward).normalize();
      root.visible = visible || right.shown > 0.02 || left.shown > 0.02;
      updateArm(right, 1, dt, rightTarget, pose, showRight);
      updateArm(left, -1, dt, leftTarget, pose, showLeft);
    },
    hideImmediately() {
      right.shown = 0;
      left.shown = 0;
      right.root.visible = false;
      left.root.visible = false;
      root.visible = false;
    },
  };
}

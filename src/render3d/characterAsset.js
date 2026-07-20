// GOLF COURSE FLIPPER — articulated character, built in code (style guide §5).
// A jointed figure (hip/knee/shoulder pivots under a chest pivot) with
// procedural Walk / Idle / Swing / Browse animation. Chosen after the rigged
// GLB path exported broken skins twice (see DEV_LOG 2026-07-09 asset session):
// this keeps real articulated motion fully under our control, no exporter risk.

import * as THREE from 'three';

const M = (color, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough });

function box(w, h, d, mat, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(0, y, z);
  m.castShadow = true;
  return m;
}

function capsule(radius, length, mat, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 3, 8), mat);
  m.position.set(0, y, z);
  m.castShadow = true;
  return m;
}

export function makeCharacter({ polo = 0x3b6fb3, khaki = 0xc2b190, cap = 0xf2efe4, skin = 0xd9a97e } = {}) {
  const mPolo = M(polo, 0.8);
  const mKhaki = M(khaki, 0.85);
  const mSkin = M(skin, 0.7);
  const mCap = cap == null ? null : M(cap, 0.8);
  const mShoe = M(0x33291f, 0.9);

  const root = new THREE.Group();

  // pelvis + legs hang off the root; chest carries torso/head/arms for lean+twist
  const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.20, 0.20, 8), mKhaki);
  pelvis.position.y = 1.03;
  pelvis.castShadow = true;
  root.add(pelvis);

  const chest = new THREE.Group();
  chest.position.y = 1.12;
  root.add(chest);
  const shirt = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.245, 0.50, 8), mPolo);
  shirt.position.y = 0.27;
  shirt.scale.z = 0.64;
  shirt.castShadow = true;
  chest.add(shirt);
  // A belt is a band around the waist, not a rectangular plate through it.
  // The shallow eight-sided ring follows the same stylised language as the
  // torso and cannot poke out as triangular corners when the chest twists.
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.202, 0.212, 0.045, 8), mShoe);
  belt.position.y = 0.025;
  belt.scale.z = 0.64;
  belt.castShadow = true;
  chest.add(belt);
  const collarL = box(0.11, 0.025, 0.018, mKhaki, 0.50, -0.132);
  collarL.rotation.z = 0.28;
  collarL.position.x = -0.05;
  const collarR = collarL.clone();
  collarR.rotation.z = -0.28;
  collarR.position.x = 0.05;
  chest.add(collarL, collarR);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.10, 8), mSkin);
  neck.position.y = 0.57;
  neck.castShadow = true;
  chest.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.62;
  chest.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 9), mSkin);
  skull.position.y = 0.06;
  skull.castShadow = true;
  head.add(skull);
  for (const x of [-0.055, 0.055]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), mShoe);
    eye.position.set(x, 0.08, -0.145);
    head.add(eye);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.022, 7, 5), mSkin);
  nose.position.set(0, 0.035, -0.158);
  head.add(nose);
  for (const x of [-0.155, 0.155]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), mSkin);
    ear.position.set(x, 0.055, 0);
    head.add(ear);
  }
  if (mCap) {
    const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.162, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), mCap);
    capTop.scale.y = 0.43;
    capTop.position.y = 0.145;
    head.add(capTop);
    const brim = box(0.155, 0.018, 0.105, mCap, 0.125, -0.145);
    brim.rotation.x = -0.08;
    head.add(brim);
  } else {
    // bare head gets hair instead of a cap
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.168, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), M(0x4a3a28, 0.95));
    hair.position.y = 0.062;
    // Keep the crown outside the skull as well as the sides; a vertically
    // squashed shell only exposed its equator and read as a dark headband.
    hair.scale.y = 0.98;
    head.add(hair);
  }

  const limbs = {};
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.285, 0.43, 0);
    chest.add(shoulder);
    shoulder.add(capsule(0.07, 0.19, mPolo, -0.15));
    const elbow = new THREE.Group();
    elbow.position.y = -0.32;
    shoulder.add(elbow);
    elbow.add(capsule(0.055, 0.18, mSkin, -0.13));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.052, 7, 5), mSkin);
    hand.position.y = -0.30;
    hand.scale.y = 1.12;
    hand.castShadow = true;
    elbow.add(hand);
    limbs[`shoulder${side}`] = shoulder;
    limbs[`elbow${side}`] = elbow;

    const hip = new THREE.Group();
    hip.position.set(sx * 0.11, 0.98, 0);
    root.add(hip);
    hip.add(capsule(0.085, 0.29, mKhaki, -0.22));
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    hip.add(knee);
    knee.add(capsule(0.072, 0.28, mKhaki, -0.20));
    // Rounded upper and a separate thin sole read as a shoe at player height,
    // while retaining the same footprint and animation pivot as the old block.
    const shoe = capsule(0.055, 0.13, mShoe, -0.42, -0.06);
    shoe.rotation.x = Math.PI / 2;
    shoe.scale.x = 1.08;
    const sole = box(0.12, 0.025, 0.23, mShoe, -0.47, -0.06);
    knee.add(shoe, sole);
    limbs[`hip${side}`] = hip;
    limbs[`knee${side}`] = knee;
  }

  const char = { root, mode: 'Idle', phase: Math.random() * 6.28 };

  char.setMode = (mode) => {
    if (char.mode !== mode) {
      char.mode = mode;
      char.phase = 0;
    }
  };

  let disposed = false;
  char.dispose = () => {
    if (disposed) return;
    disposed = true;
    const geometries = new Set();
    const materials = new Set();
    root.traverse((object) => {
      if (!object.isMesh) return;
      if (object.geometry) geometries.add(object.geometry);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (material) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  };

  const lerpSeg = (t, segs) => {
    // segs: [ [t0, v0], [t1, v1], ... ] piecewise-linear, clamped
    for (let i = 1; i < segs.length; i++) {
      if (t <= segs[i][0]) {
        const [t0, v0] = segs[i - 1];
        const [t1, v1] = segs[i];
        return v0 + (v1 - v0) * ((t - t0) / (t1 - t0 || 1));
      }
    }
    return segs[segs.length - 1][1];
  };

  char.update = (dt) => {
    char.phase += dt;
    const p = char.phase;
    let hipL = 0, hipR = 0, kneeL = 0, kneeR = 0, shL = 0, shR = 0, elb = -0.25;
    let lean = 0.04, twist = 0, headTilt = 0, bob = 0, shRz = 0;

    if (char.mode === 'Walk') {
      const w = p * 8.7; // ~1.4 strides/s
      hipL = 0.55 * Math.sin(w);
      hipR = -hipL;
      kneeL = 0.4 * Math.max(0, Math.sin(w - 1.1));
      kneeR = 0.4 * Math.max(0, Math.sin(w + Math.PI - 1.1));
      shL = -0.45 * Math.sin(w);
      shR = 0.45 * Math.sin(w);
      elb = -0.35;
      lean = 0.07;
      bob = 0.02 * Math.sin(2 * w);
    } else if (char.mode === 'Swing') {
      const t = p % 2.6;
      twist = lerpSeg(t, [[0, 0], [0.7, 0], [1.2, 0.55], [1.45, -0.6], [2.1, 0], [2.6, 0]]);
      const arm = lerpSeg(t, [[0, -0.5], [0.7, -0.5], [1.2, -1.5], [1.45, 0.7], [2.1, -0.5], [2.6, -0.5]]);
      shL = arm; shR = arm * 0.85;
      elb = -0.3;
      lean = 0.16;
      headTilt = 0.28;
    } else if (char.mode === 'Browse') {
      const r = lerpSeg(p % 3.2, [[0, 0], [0.5, -1.25], [1.9, -1.0], [2.6, 0], [3.2, 0]]);
      shR = r;
      elb = r < -0.5 ? -0.55 : -0.25;
      shL = 0.05;
      headTilt = 0.2;
      bob = 0.008 * Math.sin(p * 2);
    } else { // Idle
      lean = 0.03 + 0.015 * Math.sin(p * 1.1);
      shL = 0.06 + 0.03 * Math.sin(p * 1.1);
      shR = 0.06 + 0.03 * Math.sin(p * 1.1 + 0.4);
      shRz = -0.06;
      bob = 0.01 * Math.sin(p * 1.1);
    }

    limbs.hipL.rotation.x = hipL;
    limbs.hipR.rotation.x = hipR;
    limbs.kneeL.rotation.x = kneeL;
    limbs.kneeR.rotation.x = kneeR;
    limbs.shoulderL.rotation.x = shL;
    limbs.shoulderR.rotation.x = shR;
    limbs.shoulderL.rotation.z = 0.06;
    limbs.shoulderR.rotation.z = shRz || -0.06;
    limbs.elbowL.rotation.x = elb;
    limbs.elbowR.rotation.x = elb;
    chest.rotation.x = lean;
    chest.rotation.y = twist;
    head.rotation.x = headTilt;
    chest.position.y = 1.12 + bob; // bob lives on the body — root stays placeable
    pelvis.position.y = 1.03 + bob * 0.7;
  };

  char.update(0.001); // land in a valid pose immediately
  return char;
}

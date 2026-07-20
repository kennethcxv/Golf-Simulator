// GOLF COURSE FLIPPER — articulated character, built in code (style guide §5).
// A jointed figure (hip/knee/shoulder pivots under a chest pivot) with
// procedural Walk / Idle / Swing / Browse animation. Chosen after the rigged
// GLB path exported broken skins twice (see DEV_LOG 2026-07-09 asset session):
// this keeps real articulated motion fully under our control, no exporter risk.

import * as THREE from 'three';

const materialCache = new Map();
const boxGeometryCache = new Map();
const M = (color, rough = 0.85) => {
  const key = `${color}:${rough}`;
  if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough }));
  return materialCache.get(key);
};

function boxGeometry(w, h, d) {
  const key = `${w}:${h}:${d}`;
  if (!boxGeometryCache.has(key)) boxGeometryCache.set(key, new THREE.BoxGeometry(w, h, d));
  return boxGeometryCache.get(key);
}

function box(w, h, d, mat, y = 0, z = 0) {
  const m = new THREE.Mesh(boxGeometry(w, h, d), mat);
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
  const pelvis = box(0.34, 0.2, 0.22, mKhaki, 1.03);
  root.add(pelvis);

  const chest = new THREE.Group();
  chest.position.y = 1.12;
  root.add(chest);
  chest.add(box(0.46, 0.52, 0.26, mPolo, 0.26));
  const head = new THREE.Group();
  head.position.y = 0.62;
  chest.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 9), mSkin);
  skull.position.y = 0.06;
  skull.castShadow = true;
  head.add(skull);
  if (mCap) {
    const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12), mCap);
    capTop.position.y = 0.19;
    head.add(capTop);
    const brim = box(0.2, 0.03, 0.16, mCap, 0.16, -0.16);
    head.add(brim);
  } else {
    // bare head gets hair instead of a cap
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.1), M(0x4a3a28, 0.95));
    hair.position.y = 0.1;
    head.add(hair);
  }

  const limbs = {};
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.285, 0.43, 0);
    chest.add(shoulder);
    shoulder.add(box(0.11, 0.32, 0.13, mPolo, -0.15));
    const elbow = new THREE.Group();
    elbow.position.y = -0.32;
    shoulder.add(elbow);
    elbow.add(box(0.09, 0.28, 0.11, mSkin, -0.13));
    const hand = new THREE.Group();
    hand.position.y = -0.28;
    const handMesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), mSkin);
    handMesh.scale.set(0.8, 1.05, 0.8);
    handMesh.castShadow = true;
    hand.add(handMesh);
    elbow.add(hand);
    limbs[`shoulder${side}`] = shoulder;
    limbs[`elbow${side}`] = elbow;
    limbs[`hand${side}`] = hand;

    const hip = new THREE.Group();
    hip.position.set(sx * 0.11, 0.98, 0);
    root.add(hip);
    hip.add(box(0.15, 0.46, 0.17, mKhaki, -0.22));
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    hip.add(knee);
    knee.add(box(0.12, 0.42, 0.14, mKhaki, -0.19));
    const shoe = box(0.13, 0.09, 0.26, mShoe, -0.42, -0.04);
    knee.add(shoe);
    limbs[`hip${side}`] = hip;
    limbs[`knee${side}`] = knee;
  }

  const char = {
    root,
    mode: 'Idle',
    phase: Math.random() * 6.28,
    // A stable attachment pivot at the end of the right forearm. Props mounted
    // here inherit the procedural shoulder/elbow motion instead of floating at
    // the character root while the player swings.
    grip: limbs.handR,
  };

  char.setMode = (mode) => {
    if (char.mode !== mode) {
      char.mode = mode;
      char.phase = 0;
    }
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

    if (char.mode === 'Walk' || char.mode === 'WalkBag') {
      const w = p * 8.7; // ~1.4 strides/s
      hipL = 0.55 * Math.sin(w);
      hipR = -hipL;
      kneeL = 0.4 * Math.max(0, Math.sin(w - 1.1));
      kneeR = 0.4 * Math.max(0, Math.sin(w + Math.PI - 1.1));
      shL = char.mode === 'WalkBag' ? -0.45 : -0.45 * Math.sin(w);
      shR = char.mode === 'WalkBag' ? -0.68 : 0.45 * Math.sin(w);
      elb = -0.35;
      lean = 0.07;
      bob = 0.02 * Math.sin(2 * w);
    } else if (char.mode === 'Sit') {
      hipL = -1.35;
      hipR = -1.35;
      kneeL = 1.35;
      kneeR = 1.35;
      shL = -0.28;
      shR = -0.28;
      elb = -0.7;
      lean = 0.06;
      bob = 0.006 * Math.sin(p * 4.5);
    } else if (['Swing', 'DriverSwing', 'IronSwing', 'PracticeSwing', 'BunkerSwing'].includes(char.mode)) {
      const cycle = char.mode === 'PracticeSwing' ? 2.9 : 2.6;
      const t = p % cycle;
      const power = char.mode === 'DriverSwing' ? 1.12 : char.mode === 'BunkerSwing' ? 1.18 : 1;
      twist = power * lerpSeg(t, [[0, 0], [0.45, 0.03], [0.72, -0.04], [1.2, 0.55], [1.43, -0.6], [2.15, 0], [cycle, 0]]);
      const arm = power * lerpSeg(t, [[0, -0.5], [0.45, -0.53], [0.72, -0.47], [1.2, -1.5], [1.43, 0.7], [2.15, -0.5], [cycle, -0.5]]);
      shL = arm; shR = arm * 0.85;
      elb = char.mode === 'BunkerSwing' ? -0.18 : -0.3;
      lean = char.mode === 'BunkerSwing' ? 0.24 : 0.16;
      headTilt = 0.28;
    } else if (char.mode === 'Chip') {
      const t = p % 2.25;
      twist = lerpSeg(t, [[0, 0], [0.75, 0.2], [1.05, -0.24], [1.6, 0], [2.25, 0]]);
      const arm = lerpSeg(t, [[0, -0.58], [0.75, -0.92], [1.05, -0.16], [1.6, -0.58], [2.25, -0.58]]);
      shL = arm; shR = arm * 0.9; elb = -0.32; lean = 0.2; headTilt = 0.32;
    } else if (char.mode === 'Putt') {
      const t = p % 2.2;
      twist = lerpSeg(t, [[0, 0], [0.8, 0.1], [1.08, -0.13], [1.55, 0], [2.2, 0]]);
      shL = -0.7; shR = -0.67; elb = -0.22; lean = 0.34; headTilt = 0.38;
    } else if (char.mode === 'Address' || char.mode === 'Tee') {
      shL = -0.48 + Math.sin(p * 2.8) * 0.025;
      shR = -0.44 - Math.sin(p * 2.8) * 0.025;
      elb = -0.28; lean = 0.17; headTilt = 0.28;
    } else if (char.mode === 'Watch') {
      shL = -0.08; shR = -0.12; elb = -0.22;
      lean = -0.015; headTilt = -0.18 + Math.sin(p * 0.8) * 0.025;
    } else if (char.mode === 'Wait') {
      shL = -0.08; shR = -0.74; elb = -1.2; lean = 0.025;
      headTilt = 0.08 + Math.sin(p * 0.6) * 0.06;
    } else if (char.mode === 'Conversation') {
      shL = -0.15 + Math.sin(p * 1.4) * 0.16;
      shR = -0.3 + Math.sin(p * 1.1 + 1) * 0.25;
      elb = -0.48; headTilt = Math.sin(p * 0.75) * 0.1;
    } else if (char.mode === 'Scorecard') {
      shL = -0.92; shR = -1.06 + Math.sin(p * 7) * 0.055;
      elb = -1.15; lean = 0.12; headTilt = 0.34;
    } else if (char.mode === 'Celebrate') {
      shL = -2.55; shR = -2.45; elb = -0.1;
      lean = -0.08; bob = Math.max(0, Math.sin(p * 6)) * 0.06;
    } else if (char.mode === 'Frustration') {
      shL = -2.1; shR = -2.05; elb = -1.25;
      lean = 0.14; headTilt = 0.4;
    } else if (char.mode === 'Pickup' || char.mode === 'Flag') {
      const reach = Math.min(1, p * 2.5);
      shL = -0.8 * reach; shR = -1.15 * reach; elb = -0.2;
      lean = 0.65 * reach; headTilt = 0.42; hipL = -0.25 * reach; kneeL = 0.5 * reach;
    } else if (char.mode === 'CartEnter' || char.mode === 'CartExit') {
      const enter = char.mode === 'CartEnter' ? Math.min(1, p * 1.4) : Math.max(0, 1 - Math.min(1, p * 1.4));
      hipL = -1.35 * enter; hipR = -1.35 * enter;
      kneeL = 1.35 * enter; kneeR = 1.35 * enter;
      shL = -0.34 * enter; shR = -0.48 * enter; elb = -0.6; lean = 0.12 * enter;
    } else if (char.mode === 'BagLoad' || char.mode === 'BagUnload') {
      const reach = Math.sin(Math.min(Math.PI, p * 2.1));
      shL = -1.15 * reach; shR = -1.25 * reach; elb = -0.5;
      lean = 0.34 * reach; headTilt = 0.24;
    } else if (char.mode === 'RoundComplete') {
      shL = -0.2 + Math.sin(p * 1.2) * 0.18;
      shR = -0.55 + Math.sin(p * 1.6) * 0.35;
      elb = -0.65; lean = -0.02; headTilt = -0.08;
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

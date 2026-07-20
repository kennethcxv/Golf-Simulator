// GOLF COURSE FLIPPER — articulated character, built in code (style guide §5).
// A jointed figure (hip/knee/shoulder pivots under a chest pivot) with
// procedural Walk / Idle / Swing / Browse animation. Chosen after the rigged
// GLB path exported broken skins twice (see DEV_LOG 2026-07-09 asset session):
// this keeps real articulated motion fully under our control, no exporter risk.

import * as THREE from 'three';

// Articulation stays per actor; immutable GPU resources do not. A bounded
// palette and geometry cache prevents a busy clubhouse from allocating a new
// material/geometry set for every arrival.
const materials = new Map();
const geometries = new Map();
const M = (color, rough = 0.85) => {
  const key = `${color}|${rough}`;
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough }));
  return materials.get(key);
};
const G = (key, build) => {
  if (!geometries.has(key)) geometries.set(key, build());
  return geometries.get(key);
};

function box(w, h, d, mat, y = 0, z = 0) {
  const m = new THREE.Mesh(G(`box|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)), mat);
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
  const skull = new THREE.Mesh(G('skull', () => new THREE.SphereGeometry(0.155, 12, 9)), mSkin);
  skull.position.y = 0.06;
  skull.castShadow = true;
  head.add(skull);
  if (mCap) {
    const capTop = new THREE.Mesh(G('cap-top', () => new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12)), mCap);
    capTop.position.y = 0.19;
    head.add(capTop);
    const brim = box(0.2, 0.03, 0.16, mCap, 0.16, -0.16);
    head.add(brim);
  } else {
    // bare head gets hair instead of a cap
    const hair = new THREE.Mesh(
      G('hair', () => new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.1)),
      M(0x4a3a28, 0.95),
    );
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
    limbs[`shoulder${side}`] = shoulder;
    limbs[`elbow${side}`] = elbow;

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

  const char = { root, mode: 'Idle', phase: Math.random() * 6.28 };

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
    } else if (['Browse', 'Inspect', 'Reach'].includes(char.mode)) {
      const r = lerpSeg(p % 3.2, [[0, 0], [0.5, -1.25], [1.9, -1.0], [2.6, 0], [3.2, 0]]);
      shR = r;
      elb = r < -0.5 ? -0.55 : -0.25;
      shL = 0.05;
      headTilt = char.mode === 'Inspect' ? 0.34 : 0.2;
      bob = 0.008 * Math.sin(p * 2);
    } else if (['Carry', 'Stage', 'Receive'].includes(char.mode)) {
      shL = -0.72 + 0.04 * Math.sin(p * 2);
      shR = -0.78 + 0.04 * Math.sin(p * 2 + 0.4);
      elb = -0.9;
      lean = char.mode === 'Stage' ? 0.16 : 0.05;
      headTilt = char.mode === 'Stage' ? 0.18 : 0.05;
    } else if (char.mode === 'PayCash' || char.mode === 'PayCard') {
      shR = char.mode === 'PayCard' ? -1.1 : -0.9;
      shL = -0.15;
      elb = -0.72;
      lean = 0.1;
      headTilt = 0.12;
    } else if (char.mode === 'Talk') {
      shL = -0.28 + 0.18 * Math.sin(p * 1.8);
      shR = -0.38 + 0.22 * Math.sin(p * 1.8 + 1.1);
      elb = -0.62;
      twist = 0.06 * Math.sin(p * 1.1);
      headTilt = 0.04 * Math.sin(p * 1.4);
    } else if (char.mode === 'Sit') {
      hipL = -1.28; hipR = -1.28;
      kneeL = 1.3; kneeR = 1.3;
      shL = 0.05; shR = 0.05;
      lean = -0.04;
    } else if (char.mode === 'Door' || char.mode === 'Turn' || char.mode === 'Leave') {
      const w = p * 6.8;
      hipL = 0.32 * Math.sin(w);
      hipR = -hipL;
      kneeL = 0.24 * Math.max(0, Math.sin(w - 1.1));
      kneeR = 0.24 * Math.max(0, Math.sin(w + Math.PI - 1.1));
      shL = -0.25 * Math.sin(w);
      shR = 0.25 * Math.sin(w);
      elb = -0.32;
      lean = 0.06;
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

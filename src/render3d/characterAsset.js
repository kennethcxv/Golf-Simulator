// GOLF COURSE FLIPPER — articulated character, built in code (style guide §5).
// A jointed figure (hip/knee/shoulder pivots under a chest pivot) with
// procedural Walk / Idle / Swing / Browse animation. Chosen after the rigged
// GLB path exported broken skins twice (see DEV_LOG 2026-07-09 asset session):
// this keeps real articulated motion fully under our control, no exporter risk.

import * as THREE from 'three';
import { CUSTOMER_IMPATIENT_BEAT_SECONDS } from './clubhouse/customerFlow.js';

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

function ellipsoid(w, h, d, mat, y = 0, z = 0, segments = 14) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, segments, Math.max(10, segments - 2)), mat);
  m.scale.set(w, h, d);
  m.position.set(0, y, z);
  m.castShadow = true;
  return m;
}

function capsule(radius, straight, mat, y = 0) {
  // rounder caps/rings than the old 4x8 — at counter distance the low silhouette
  // was the single biggest "made of tubes" tell.
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, straight, 6, 14), mat);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

// A sphere sized in absolute units — used for the joints that tie the body's
// tubes together (neck, shoulders, hips) so the figure reads as one piece.
function ball(radius, mat, segments = 16) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, Math.max(10, segments - 4)), mat);
  m.castShadow = true;
  return m;
}

export function makeCharacter({ polo = 0x3b6fb3, khaki = 0xc2b190, cap = 0xf2efe4, skin = 0xd9a97e } = {}) {
  const mPolo = M(polo, 0.8);
  const mKhaki = M(khaki, 0.85);
  const mSkin = M(skin, 0.7);
  const mCap = cap == null ? null : M(cap, 0.8);
  const mShoe = M(0x33291f, 0.9);
  const mSole = M(0x1c1916, 0.95); // rubber shoe sole, darker than the leather upper
  const mBelt = M(0x40382f, 0.78);

  const root = new THREE.Group();

  // pelvis + legs hang off the root; chest carries torso/head/arms for lean+twist.
  // The whole figure is built so the SHOE SOLES sit at model y≈0: the game places a
  // character's root exactly on the floor/terrain, so a body whose feet were at y≈0.05
  // hovered ~5 cm above the ground. Every base height below is lowered to plant the feet.
  const pelvis = ellipsoid(0.32, 0.18, 0.21, mKhaki, 0.98);
  root.add(pelvis);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.198, 0.038, 18), mBelt);
  belt.position.y = 1.055;
  belt.scale.z = 0.74;
  belt.castShadow = true;
  root.add(belt);

  const chest = new THREE.Group();
  chest.position.y = 1.07;
  root.add(chest);
  // A smooth revolved shirt profile provides a waist, ribcage and collar slope
  // without the visibly flat cap of a tapered cylinder.
  const torso = new THREE.Mesh(new THREE.LatheGeometry([
    // Close the underside on the axis. Leaving the first ring open exposed
    // alternating triangle backs as a sawtooth hem in the player camera.
    new THREE.Vector2(0, -0.061),
    new THREE.Vector2(0.190, -0.060),
    new THREE.Vector2(0.202, -0.018),
    new THREE.Vector2(0.212, 0.035),
    new THREE.Vector2(0.238, 0.320),
    new THREE.Vector2(0.226, 0.425),
    new THREE.Vector2(0.150, 0.492),
    new THREE.Vector2(0.094, 0.515),
  ], 24), mPolo);
  torso.scale.z = 0.72;
  torso.castShadow = true;
  chest.add(torso);

  // --- CONNECTIVE TISSUE ---------------------------------------------------------------------
  // The figure used to be a pile of separate tubes and balls with air at every joint — a
  // floating head worst of all. These pieces are children of the chest, so they lean, twist
  // and bob WITH the torso; they carry no rig, they just close the gaps.
  // A polo shoulder yoke lying across the top of the chest, tying both arm-roots into the body.
  const yoke = new THREE.Mesh(new THREE.CapsuleGeometry(0.135, 0.26, 6, 14), mPolo);
  yoke.rotation.z = Math.PI / 2;
  yoke.scale.set(1, 1, 0.82);
  yoke.position.y = 0.4;
  yoke.castShadow = true;
  chest.add(yoke);
  // A skin neck rising out of the collar and into the skull — no more floating head.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.076, 0.18, 16), mSkin);
  neck.position.y = 0.47;
  neck.castShadow = true;
  chest.add(neck);
  // The lathed torso itself now overlaps the waistband. The previous separate
  // cylinder hem occupied the same surface and produced a dark, jagged
  // z-fighting seam in every handoff frame.
  // A folded polo collar at the neckline — the fabric detail that turns "blue tube with a
  // ball on top" into a shirt. An open flared cone in the shirt material.
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.108, 0.072, 0.058, 18, 1, true), mPolo);
  collar.position.y = 0.415;
  collar.castShadow = true;
  chest.add(collar);
  // A short placket + two buttons down the chest so the front reads as a polo.
  const placket = box(0.028, 0.17, 0.012, M(polo, 0.62), 0.30, 0.138);
  chest.add(placket);
  for (const by of [0.34, 0.26]) {
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.010, 8, 6), M(0xf3efe6, 0.5));
    button.position.set(0, by, 0.144);
    chest.add(button);
  }

  const head = new THREE.Group();
  head.position.y = 0.62;
  chest.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.155, 20, 14), mSkin);
  skull.position.y = 0.06;
  skull.castShadow = true;
  head.add(skull);
  const mFace = M(0x2b2521, 0.9);
  const mBrow = M(0x4a3524, 0.9);
  const mEyeLight = M(0xf5ead7, 0.55);
  for (const x of [-0.057, 0.057]) {
    // The old eyes were 12 mm dots that vanished into a blank, faintly unsettling face
    // at the counter distance. A slightly larger almond eye with a soft brow above it
    // gives a readable, friendly expression without breaking the shop's simple heads.
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0165, 10, 7), mFace);
    // Keep the features proud of the 15.5 cm skull. At the former z=0.139,
    // almost the entire eye sat behind the sphere at register distance.
    eye.position.set(x, 0.083, 0.157);
    eye.scale.set(0.9, 1.12, 0.72);
    head.add(eye);
    const catchlight = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 7, 5), mEyeLight);
    catchlight.position.set(x - 0.004, 0.088, 0.168);
    head.add(catchlight);
    const brow = box(0.052, 0.012, 0.014, mBrow, 0.114, 0.137);
    brow.position.x = x * 1.02;
    brow.position.z = 0.158;
    brow.rotation.z = x < 0 ? 0.14 : -0.14;
    head.add(brow);
  }
  const nose = ellipsoid(0.034, 0.045, 0.030, mSkin, 0.043, 0.163, 8);
  head.add(nose);
  const mouth = box(0.058, 0.011, 0.010, mFace, -0.028, 0.158);
  mouth.rotation.x = 0.12; // a faint upward set, so the resting face is neutral-friendly
  head.add(mouth);
  for (const x of [-0.158, 0.158]) {
    const ear = ellipsoid(0.025, 0.052, 0.020, mSkin, 0.052, 0.004, 8);
    ear.position.x = x;
    head.add(ear);
  }
  if (mCap) {
    // A soft golf cap: a domed crown hugging the skull, a top button, and a curved bill —
    // not a soup can with a slab stuck to it.
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.168, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), mCap);
    crown.scale.set(1.02, 0.94, 1.06);
    crown.position.y = 0.05;
    crown.castShadow = true;
    head.add(crown);
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), mCap);
    button.position.y = 0.196;
    head.add(button);
    // curved bill: a flattened, slightly down-tilted disc projecting from the crown front
    const bill = ellipsoid(0.185, 0.026, 0.155, mCap, 0.108, 0.14, 16);
    bill.rotation.x = 0.17;
    head.add(bill);
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
    shoulder.position.set(sx * 0.265, 0.42, 0);
    chest.add(shoulder);
    // deltoid cap at the pivot: a polo ball merging the yoke into the sleeve. Sitting on
    // the joint centre, it caps the shoulder at every arm angle without a visible socket.
    const deltoid = ball(0.080, mPolo, 16);
    deltoid.scale.set(0.94, 0.90, 0.84);
    shoulder.add(deltoid);
    const upperArm = capsule(0.056, 0.20, mPolo, -0.15);
    upperArm.scale.z = 0.88;
    shoulder.add(upperArm);
    // the short-sleeve hem, a slightly proud fabric ring where the polo sleeve ends
    const sleeveCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.062, 0.03, 14), mPolo);
    sleeveCuff.position.y = -0.275;
    sleeveCuff.castShadow = true;
    shoulder.add(sleeveCuff);
    const elbow = new THREE.Group();
    elbow.position.y = -0.32;
    shoulder.add(elbow);
    // elbow cap: a skin ball at the pivot closing the sleeve→forearm gap at every arm angle
    const elbowCap = ball(0.052, mSkin, 12);
    elbow.add(elbowCap);
    const forearm = capsule(0.050, 0.18, mSkin, -0.13);
    forearm.scale.z = 0.88;
    elbow.add(forearm);
    // a shaped hand — a flatter palm than the old blob, plus a thumb, so it reads as a hand
    // that could hold a card. Position is preserved: the carry grip below copies it.
    const hand = ellipsoid(0.074, 0.118, 0.052, mSkin, -0.295, -0.005, 10);
    elbow.add(hand);
    const thumb = ellipsoid(0.030, 0.060, 0.030, mSkin, -0.262, 0.028, 8);
    thumb.position.x = sx * 0.046;
    elbow.add(thumb);
    // Four overlapping low-poly finger forms preserve the stylised silhouette
    // while making card, cash, receipt and bag ownership readable in close-ups.
    // They remain geometry only; the generous gameplay hit targets stay hidden.
    for (let fingerIndex = 0; fingerIndex < 4; fingerIndex += 1) {
      const finger = ellipsoid(
        0.018,
        0.052 - fingerIndex * 0.003,
        0.024,
        mSkin,
        -0.340 + Math.abs(fingerIndex - 1.5) * 0.002,
        0.010,
        8,
      );
      finger.position.x = (fingerIndex - 1.5) * 0.014;
      finger.rotation.z = (fingerIndex - 1.5) * -0.025;
      elbow.add(finger);
    }
    // A sibling of the non-uniformly scaled hand mesh gives carried props a
    // stable attachment joint.  Parenting a shopping bag to the hand mesh
    // itself would squash it; parenting it to the elbow loses the authored
    // hand position and forces every caller to guess an offset.
    const carryGrip = new THREE.Group();
    carryGrip.name = `CarryGrip${side}`;
    carryGrip.position.copy(hand.position);
    carryGrip.position.x += sx * 0.045; // stay inside the palm, biased away from the torso
    carryGrip.position.z += 0.015;
    carryGrip.userData.kind = 'customer-carry-grip';
    elbow.add(carryGrip);
    limbs[`shoulder${side}`] = shoulder;
    limbs[`elbow${side}`] = elbow;
    limbs[`hand${side}`] = hand;
    limbs[`carryGrip${side}`] = carryGrip;

    const hip = new THREE.Group();
    hip.position.set(sx * 0.10, 0.93, 0);
    root.add(hip);
    // hip cap at the pivot: a khaki ball tying the pelvis into the thigh, closing the
    // crotch/hip gap that made the legs read as two loose posts under a bowl.
    const hipCap = ball(0.072, mKhaki, 14);
    hipCap.scale.set(0.90, 0.76, 0.86);
    hip.add(hipCap);
    const thigh = capsule(0.078, 0.30, mKhaki, -0.22);
    thigh.scale.z = 0.92;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    hip.add(knee);
    // knee cap: a khaki ball at the pivot closing the thigh→shin gap
    const kneeCap = ball(0.072, mKhaki, 12);
    kneeCap.scale.set(1, 0.92, 0.98);
    knee.add(kneeCap);
    const shin = capsule(0.064, 0.29, mKhaki, -0.19);
    shin.scale.z = 0.92;
    knee.add(shin);
    // a real shoe: a soft leather upper on a rubber sole with a rounded toe, in place of the
    // dark block that used to sit under the trouser cuff.
    const sole = box(0.135, 0.035, 0.30, mSole, -0.452, -0.03);
    sole.castShadow = true;
    knee.add(sole);
    const foot = ellipsoid(0.128, 0.115, 0.235, mShoe, -0.398, -0.05, 12);
    knee.add(foot);
    const toe = ellipsoid(0.118, 0.088, 0.13, mShoe, -0.41, -0.135, 12);
    knee.add(toe);
    const tongue = box(0.075, 0.05, 0.10, mShoe, -0.352, 0.01);
    tongue.rotation.x = -0.25;
    knee.add(tongue);
    limbs[`hip${side}`] = hip;
    limbs[`knee${side}`] = knee;
  }

  // Snapshot only the resources built by this character factory. Checkout later
  // parents shared merchandise proxies and the paid-bag GLB under this hierarchy;
  // a teardown-time traversal would incorrectly dispose those cache-owned assets.
  const ownedGeometries = new Set();
  const ownedMaterials = new Set();
  root.traverse((object) => {
    if (object.geometry && typeof object.geometry.dispose === 'function') {
      ownedGeometries.add(object.geometry);
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material && typeof material.dispose === 'function') ownedMaterials.add(material);
    }
  });

  let resourcesDisposed = false;
  const char = {
    root,
    mode: 'Idle',
    phase: Math.random() * 6.28,
    dispose() {
      if (resourcesDisposed) return false;
      resourcesDisposed = true;
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
      return true;
    },
  };

  char.setMode = (mode) => {
    if (char.mode !== mode) {
      char.mode = mode;
      char.phase = 0;
    }
  };
  char.hand = (side = 'R') => limbs[`hand${side}`] || limbs.handR;
  char.carryGrip = (side = 'R') => limbs[`carryGrip${side}`] || limbs.carryGripR;

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
    let lean = 0.04, twist = 0, headTilt = 0, bob = 0, shLz = 0.06, shRz = -0.06;

    if (char.mode === 'Walk' || char.mode === 'WalkBag') {
      const w = p * 8.7; // ~1.4 strides/s
      hipL = 0.55 * Math.sin(w);
      hipR = -hipL;
      kneeL = 0.4 * Math.max(0, Math.sin(w - 1.1));
      kneeR = 0.4 * Math.max(0, Math.sin(w + Math.PI - 1.1));
      if (char.mode === 'WalkBag') {
        // Ease from the two-handed acceptance pose into a one-handed side
        // carry, avoiding a one-frame snap as the customer turns to leave.
        const u = Math.min(1, p / 0.55);
        const settle = u * u * (3 - 2 * u);
        // Keep the loaded carrier at waist height until the shopper clears the
        // counter. A fully dropped arm hides the entire bag behind the walnut top.
        shL = -1.18 + 0.025 * Math.sin(w * 0.5) * settle;
        shR = -1.00 * (1 - settle) + 0.38 * Math.sin(w) * settle;
        elb = -0.66 * (1 - settle) - 0.68 * settle;
        lean = 0.14 * (1 - settle) + 0.07 * settle;
      } else {
        shL = -0.45 * Math.sin(w);
        shR = 0.45 * Math.sin(w);
        elb = -0.35;
        lean = 0.07;
      }
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
      const r = lerpSeg(p % 3.2, [[0, 0], [0.5, 1.25], [1.9, 1.0], [2.6, 0], [3.2, 0]]);
      shR = r;
      elb = r > 0.5 ? -0.55 : -0.25;
      shL = 0.05;
      headTilt = char.mode === 'Inspect' ? 0.34 : 0.2;
      bob = 0.008 * Math.sin(p * 2);
    } else if (char.mode === 'Checkout') {
      // Both hands reach over the product surface with a small alternating lead.
      // The item-placement controller reads the wrist objects below, giving its
      // product arc a real animation target instead of a floating chest origin.
      shR = -1.02 + Math.sin(p * 3.2) * 0.08;
      shL = -0.78 + Math.sin(p * 3.2 + Math.PI) * 0.06;
      elb = -0.52;
      lean = 0.12;
      headTilt = 0.14;
    } else if (char.mode === 'Present') {
      // Wallet/card/cash presentation: one hand reaches naturally across the
      // customer edge while the other stays close to the torso.
      shR = -1.12 + Math.sin(p * 2.6) * 0.035;
      shL = -0.14;
      elb = -0.62;
      lean = 0.13;
      headTilt = 0.08;
    } else if (char.mode === 'Receive') {
      shR = -1.05;
      shL = -0.10;
      elb = -0.72;
      lean = 0.10;
      headTilt = 0.16;
    } else if (char.mode === 'ReceiveBag') {
      shR = -1.00;
      shL = -1.18;
      elb = -0.66;
      lean = 0.14;
      // A small appreciative nod makes the ownership transfer read as a positive
      // customer reaction without turning checkout into an arcade celebration.
      const nod = Math.sin(Math.min(1, p / 1.25) * Math.PI * 2);
      headTilt = 0.10 + nod * 0.095;
      bob = Math.max(0, Math.sin(Math.min(1, p / 1.25) * Math.PI)) * 0.012;
    } else if (char.mode === 'Declined') {
      shR = 0.18;
      shL = 0.18;
      elb = -0.45;
      lean = -0.03;
      twist = Math.sin(p * 4.5) * 0.06;
      headTilt = -0.12;
    } else if (char.mode === 'Impatient') {
      // A compact folded-arm settle and one quiet head shake. It reads clearly
      // across the counter without turning a lost sale into a broad tantrum.
      const t = Math.min(1, p / CUSTOMER_IMPATIENT_BEAT_SECONDS);
      const settle = t * t * (3 - 2 * t);
      const shakeEnvelope = Math.sin(Math.PI * t);
      shL = -0.72 * settle;
      shR = -0.72 * settle;
      shLz = 0.06 - 0.36 * settle;
      shRz = -0.06 + 0.36 * settle;
      elb = -0.95 * settle - 0.25 * (1 - settle);
      lean = 0.02 - 0.055 * settle;
      twist = Math.sin(t * Math.PI * 3) * 0.075 * shakeEnvelope;
      headTilt = -0.08 * settle;
      bob = -0.008 * settle;
    } else { // Idle
      lean = 0.03 + 0.015 * Math.sin(p * 1.1);
      shL = 0.06 + 0.03 * Math.sin(p * 1.1);
      shR = 0.06 + 0.03 * Math.sin(p * 1.1 + 0.4);
      shRz = -0.06;
      bob = 0.01 * Math.sin(p * 1.1);
    }

    const sitOffset = char.mode === 'Sit' ? -0.5 : 0;
    limbs.hipL.rotation.x = hipL;
    limbs.hipR.rotation.x = hipR;
    limbs.hipL.position.y = 0.98 + sitOffset;
    limbs.hipR.position.y = 0.98 + sitOffset;
    limbs.kneeL.rotation.x = kneeL;
    limbs.kneeR.rotation.x = kneeR;
    limbs.shoulderL.rotation.x = shL;
    limbs.shoulderR.rotation.x = shR;
    limbs.shoulderL.rotation.z = shLz;
    limbs.shoulderR.rotation.z = shRz;
    limbs.elbowL.rotation.x = elb;
    limbs.elbowR.rotation.x = elb;
    chest.rotation.x = lean;
    chest.rotation.y = twist;
    head.rotation.x = headTilt;
    chest.position.y = 1.07 + bob; // bob lives on the body — root stays placeable
    pelvis.position.y = 0.98 + bob * 0.7;
  };

  char.update(0.001); // land in a valid pose immediately
  return char;
}

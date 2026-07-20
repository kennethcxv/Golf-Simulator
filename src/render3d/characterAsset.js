// GOLF COURSE FLIPPER — articulated character, built in code (style guide §5).
// A jointed figure (hip/knee/shoulder pivots under a chest pivot) with
// procedural Walk / Idle / Swing / Browse animation. Chosen after the rigged
// GLB path exported broken skins twice (see DEV_LOG 2026-07-09 asset session):
// this keeps real articulated motion fully under our control, no exporter risk.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CHARACTER_PART_NAMES = [
  'torso', 'pelvis', 'upper_arm', 'forearm_hand', 'thigh', 'calf', 'shoe',
  'head', 'face_details', 'cap', 'hair',
];

let characterParts = null;
let characterPartsPromise = null;
let characterPartsState = 'idle';
const sharedCharacterMaterials = new Map();

// Start this when a course scene is constructed. DefaultLoadingManager then
// keeps the existing prewarm veil up until the modular character geometry is
// resident, so the first customer never pops from primitives into final art.
export function preloadCharacterParts() {
  if (characterPartsPromise) return characterPartsPromise;
  if (typeof window === 'undefined') return Promise.resolve(null);
  characterPartsState = 'loading';
  characterPartsPromise = new Promise((resolve) => {
    new GLTFLoader().load(
      'vendor/models/clubhouse/character_parts.glb',
      (gltf) => {
        const found = {};
        const sourceGeometries = new Set();
        const sourceMaterials = new Set();
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((node) => {
          if (!node.isMesh || !node.geometry) return;
          sourceGeometries.add(node.geometry);
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          for (const material of materials) if (material) sourceMaterials.add(material);
          if (!CHARACTER_PART_NAMES.includes(node.name)) return;
          const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();
          geometry.userData.characterShared = true;
          found[node.name] = geometry;
        });
        const complete = CHARACTER_PART_NAMES.every((name) => found[name]);
        if (complete) {
          characterParts = Object.freeze(found);
          characterPartsState = 'ready';
        } else {
          for (const geometry of Object.values(found)) geometry.dispose();
          characterPartsState = 'incomplete';
        }
        for (const geometry of sourceGeometries) geometry.dispose();
        for (const material of sourceMaterials) material.dispose();
        resolve(characterParts);
      },
      undefined,
      () => {
        characterPartsState = 'failed';
        resolve(null);
      },
    );
  });
  return characterPartsPromise;
}

export function characterPartsStatus() {
  return {
    state: characterPartsState,
    ready: !!characterParts,
    materialVariants: sharedCharacterMaterials.size,
  };
}

const M = (color, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough });

function sharedM(color, rough = 0.85) {
  const resolved = color?.isColor ? color : new THREE.Color(color);
  const key = `${resolved.getHexString()}|${rough}`;
  let material = sharedCharacterMaterials.get(key);
  if (!material) {
    material = M(resolved, rough);
    material.userData.sharedCharacterMaterial = true;
    sharedCharacterMaterials.set(key, material);
  }
  return material;
}

function box(w, h, d, mat, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(0, y, z);
  m.castShadow = true;
  return m;
}

export function makeCharacter({
  polo = 0x3b6fb3,
  khaki = 0xc2b190,
  cap = 0xf2efe4,
  skin = 0xd9a97e,
  parts = characterParts,
} = {}) {
  const material = parts ? sharedM : M;
  const mPolo = material(polo, 0.8);
  const mKhaki = material(khaki, 0.85);
  const mSkin = material(skin, 0.7);
  const mCap = cap == null ? null : material(cap, 0.8);
  const mShoe = material(0x33291f, 0.9);
  const mHair = material(0x4a3a28, 0.95);
  const mDetail = material(0x30251c, 0.9);

  function authored(name, material) {
    const geometry = parts?.[name];
    if (!geometry) return null;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    // Blender's authored +Y face direction arrives as local +Z. The procedural
    // rig's established forward is -Z (cap brim, feet, checkout reach), so align
    // the visual kit once at its shared attachment boundary.
    mesh.rotation.y = Math.PI;
    mesh.castShadow = true;
    mesh.userData.sharedCharacterGeometry = true;
    return mesh;
  }

  const root = new THREE.Group();
  root.name = 'characterRoot';

  // pelvis + legs hang off the root; chest carries torso/head/arms for lean+twist
  const pelvis = authored('pelvis', mKhaki) || box(0.34, 0.2, 0.22, mKhaki);
  pelvis.position.y = 1.03;
  root.add(pelvis);

  const chest = new THREE.Group();
  chest.name = 'chestJoint';
  chest.position.y = 1.12;
  root.add(chest);
  chest.add(authored('torso', mPolo) || box(0.46, 0.52, 0.26, mPolo, 0.26));
  const head = new THREE.Group();
  head.name = 'headJoint';
  head.position.y = 0.62;
  chest.add(head);
  const skull = authored('head', mSkin) || new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 9), mSkin);
  if (!skull.userData.sharedCharacterGeometry) skull.position.y = 0.06;
  skull.castShadow = true;
  head.add(skull);
  const face = authored('face_details', mDetail);
  if (face) head.add(face);
  if (mCap) {
    const authoredCap = authored('cap', mCap);
    if (authoredCap) {
      head.add(authoredCap);
    } else {
      const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12), mCap);
      capTop.position.y = 0.19;
      head.add(capTop);
      const brim = box(0.2, 0.03, 0.16, mCap, 0.16, -0.16);
      head.add(brim);
    }
  } else {
    // bare head gets hair instead of a cap
    const hair = authored('hair', mHair)
      || new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.1), mHair);
    if (!hair.userData.sharedCharacterGeometry) hair.position.y = 0.1;
    head.add(hair);
  }

  const limbs = {};
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const shoulder = new THREE.Group();
    shoulder.name = `shoulder${side}`;
    shoulder.position.set(sx * 0.285, 0.43, 0);
    chest.add(shoulder);
    const upperArm = authored('upper_arm', mPolo) || box(0.11, 0.32, 0.13, mPolo, -0.15);
    if (upperArm.userData.sharedCharacterGeometry) upperArm.scale.x = sx;
    shoulder.add(upperArm);
    const elbow = new THREE.Group();
    elbow.name = `elbow${side}`;
    elbow.position.y = -0.32;
    shoulder.add(elbow);
    const forearm = authored('forearm_hand', mSkin) || box(0.09, 0.28, 0.11, mSkin, -0.13);
    if (forearm.userData.sharedCharacterGeometry) forearm.scale.x = sx;
    elbow.add(forearm);
    // An authored attachment at the end of the forearm. Checkout uses this for
    // its real hand target and for the carrier, so neither can float beside a
    // differently scaled customer.
    const hand = new THREE.Object3D();
    hand.name = `hand${side}`;
    hand.position.y = -0.28;
    elbow.add(hand);
    limbs[`shoulder${side}`] = shoulder;
    limbs[`elbow${side}`] = elbow;
    limbs[`hand${side}`] = hand;

    const hip = new THREE.Group();
    hip.name = `hip${side}`;
    hip.position.set(sx * 0.11, 0.98, 0);
    root.add(hip);
    hip.add(authored('thigh', mKhaki) || box(0.15, 0.46, 0.17, mKhaki, -0.22));
    const knee = new THREE.Group();
    knee.name = `knee${side}`;
    knee.position.y = -0.46;
    hip.add(knee);
    knee.add(authored('calf', mKhaki) || box(0.12, 0.42, 0.14, mKhaki, -0.19));
    const shoe = authored('shoe', mShoe) || box(0.13, 0.09, 0.26, mShoe, -0.42, -0.04);
    if (shoe.userData.sharedCharacterGeometry) shoe.position.set(0, -0.47, -0.04);
    knee.add(shoe);
    limbs[`hip${side}`] = hip;
    limbs[`knee${side}`] = knee;
  }

  // Gravity-upright carrier anchor at the hand position of the raised carry pose.
  // It follows chest bob/turn but not the shoulder and elbow rotations, so a bag
  // does not pitch sideways merely because the forearm bends around its handle.
  const carryAnchor = new THREE.Group();
  carryAnchor.name = 'carryAnchor';
  carryAnchor.position.set(0.285, 0.373, 0.524);
  chest.add(carryAnchor);

  // Materials and fallback primitives belong to this character. Blender part
  // geometry is shared by every figure and lives for the app session, so it must
  // survive teardown. Capture ownership before callers attach merchandise or
  // temporary checkout feedback beneath the root.
  const ownedGeometries = new Set();
  const ownedMaterials = new Set(
    [mPolo, mKhaki, mSkin, mShoe, mHair, mDetail, mCap]
      .filter((item) => item && !item.userData.sharedCharacterMaterial),
  );
  root.traverse((node) => {
    if (!node.isMesh) return;
    if (node.geometry && !node.userData.sharedCharacterGeometry) ownedGeometries.add(node.geometry);
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (material && !material.userData.sharedCharacterMaterial) ownedMaterials.add(material);
    }
  });

  const char = {
    root,
    handL: limbs.handL,
    handR: limbs.handR,
    carryAnchor,
    mode: 'Idle',
    phase: Math.random() * 6.28,
    carrying: false,
    skinColor: skin,
    assetKind: parts ? 'blender' : 'procedural-fallback',
  };

  char.setMode = (mode) => {
    if (char.mode !== mode) {
      char.mode = mode;
      char.phase = 0;
    }
  };
  char.setCarrying = (carrying) => { char.carrying = !!carrying; };
  char.dispose = () => {
    for (const geometry of ownedGeometries) geometry.dispose();
    for (const material of ownedMaterials) material.dispose();
    ownedGeometries.clear();
    ownedMaterials.clear();
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
    let hipL = 0, hipR = 0, kneeL = 0, kneeR = 0, shL = 0, shR = 0;
    let elbL = -0.25, elbR = -0.25;
    let lean = 0.04, twist = 0, headTilt = 0, bob = 0, shRz = 0;

    if (char.mode === 'Walk') {
      const w = p * 8.7; // ~1.4 strides/s
      hipL = 0.55 * Math.sin(w);
      hipR = -hipL;
      kneeL = 0.4 * Math.max(0, Math.sin(w - 1.1));
      kneeR = 0.4 * Math.max(0, Math.sin(w + Math.PI - 1.1));
      shL = -0.45 * Math.sin(w);
      shR = 0.45 * Math.sin(w);
      elbL = -0.35;
      elbR = -0.35;
      lean = 0.07;
      bob = 0.02 * Math.sin(2 * w);
    } else if (char.mode === 'Swing') {
      const t = p % 2.6;
      twist = lerpSeg(t, [[0, 0], [0.7, 0], [1.2, 0.55], [1.45, -0.6], [2.1, 0], [2.6, 0]]);
      const arm = lerpSeg(t, [[0, -0.5], [0.7, -0.5], [1.2, -1.5], [1.45, 0.7], [2.1, -0.5], [2.6, -0.5]]);
      shL = arm; shR = arm * 0.85;
      elbL = -0.3;
      elbR = -0.3;
      lean = 0.16;
      headTilt = 0.28;
    } else if (char.mode === 'Browse') {
      const r = lerpSeg(p % 3.2, [[0, 0], [0.5, -1.25], [1.9, -1.0], [2.6, 0], [3.2, 0]]);
      shR = r;
      elbL = r < -0.5 ? -0.55 : -0.25;
      elbR = elbL;
      shL = 0.05;
      headTilt = 0.2;
      bob = 0.008 * Math.sin(p * 2);
    } else if (char.mode === 'Checkout') {
      // Left arm crosses the short customer-side gap and ends at the physical
      // tender/handoff target. A small breathing motion keeps the pose alive.
      lean = -0.01 + 0.012 * Math.sin(p * 1.4);
      shL = -0.72 + 0.025 * Math.sin(p * 1.4);
      elbL = -0.38;
      shR = 0.04;
      elbR = -0.22;
      headTilt = 0.10;
    } else { // Idle
      lean = 0.03 + 0.015 * Math.sin(p * 1.1);
      shL = 0.06 + 0.03 * Math.sin(p * 1.1);
      shR = 0.06 + 0.03 * Math.sin(p * 1.1 + 0.4);
      shRz = -0.06;
      bob = 0.01 * Math.sin(p * 1.1);
    }

    // Once served, the same arm becomes a stable carry arm while the walk cycle
    // continues underneath it. The Blender carrier pivots at its handle.
    if (char.carrying) {
      shL = -1.0;
      elbL = -1.0;
    }

    limbs.hipL.rotation.x = hipL;
    limbs.hipR.rotation.x = hipR;
    limbs.kneeL.rotation.x = kneeL;
    limbs.kneeR.rotation.x = kneeR;
    limbs.shoulderL.rotation.x = shL;
    limbs.shoulderR.rotation.x = shR;
    limbs.shoulderL.rotation.z = 0.06;
    limbs.shoulderR.rotation.z = shRz || -0.06;
    limbs.elbowL.rotation.x = elbL;
    limbs.elbowR.rotation.x = elbR;
    chest.rotation.x = lean;
    chest.rotation.y = twist;
    head.rotation.x = headTilt;
    chest.position.y = 1.12 + bob; // bob lives on the body — root stays placeable
    pelvis.position.y = 1.03 + bob * 0.7;
  };

  char.update(0.001); // land in a valid pose immediately
  return char;
}

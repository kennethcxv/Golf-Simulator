// FIRST-PERSON HANDS — somebody is holding the thing, and holding it the way you would.
//
// The first pass was one closed mitt: a palm box, a single box for all four fingers, and a thumb
// capsule, moved around per tool by a table of positions. It read as a mitten at any distance, and
// every tool was gripped identically whether it was a broom shaft or a folded cloth.
//
// This is the same idea done properly. The fingers are individually articulated — two segments
// each — and a grip declares a POSE rather than just a place: you wrap a shaft, you lay a palm
// flat on a cloth, you hook a bag's neck, you sit an index finger on a trigger. Cleaning tools
// take their grips straight from the tool registry, so a new tool poses hands by declaring them.
//
// One bug fixed on the way through. The hands are parented INTO the tool group, which is right —
// it puts grip poses in the tool's own frame. But recoil was written to the hands' own position,
// so pulling the trigger slid the hands *along the lance* instead of kicking the lance back. The
// recoil now comes out as an offset the caller applies to the whole held rig.

import * as THREE from 'three';
import { CLEANING_TOOLS } from '../data/cleaningTools.js';

const SKIN = 0xd9a97e;
const SKIN_SHADE = 0xc9976c; // the underside of the fingers, so knuckles read against the palm
const CUFF = 0x2f4a35; // the club's own polo green, at the wrist
const CUFF_DARK = 0x21351f; // the sleeve's rolled interior, so the opening reads as depth not a disc
const NAIL = 0xe6c39c; // a lighter flattened hint on the index and middle nails

// ORIENTATION-TRUE GRIPS.
//
// Every authored grip socket carries the SAME orientation in its tool's frame — measured at
// quaternion (0, 0.7071, 0.7071, 0), i.e. euler (-pi/2, 0, pi): the builder convention that maps
// the socket's local -Z onto the held tool's -Y shaft axis. Discarding it (the old entryPitch
// heuristic) is what left flat/hook/trigger grips fanning at the air. We now read the socket's live
// quaternion and rotate the hand by a per-pose offset expressed as the hand's DESIRED orientation
// in the tool frame at rest; the live socket quaternion carries any equip/work animation on top.
const AUTHORED_GRIP_REST = new THREE.Quaternion(0, 0.7071, 0.7071, 0);
const AUTHORED_GRIP_REST_INV = AUTHORED_GRIP_REST.clone().invert();
// Desired hand orientation in the tool group's frame, at rest, per grip pose. Tuned in-game against
// the shed evidence shots so the palm sits ON the shaft/pad and knuckles face the lower-right.
const REST_TARGET = {
  wrap: new THREE.Euler(0.40, 0.30, 0.02),
  trigger: new THREE.Euler(0.30, 0.26, 0.00),
  // B4: 1.12 STOOD THE HAND UP ON THE PAD. At that pitch the wrist rose vertically
  // out of the cloth and the fingers splayed straight into the air — a hand waving
  // beside a sponge, not one holding it, on both the cloth and the sponge, idle and
  // in use. Item 9 had already raised `flat`'s curl from 0.46 to 0.94 chasing the
  // same symptom; the curl was never the problem, the rest ORIENTATION was.
  //
  // The pad grip wants the SAME rest orientation as the shaft grip: palm down,
  // knuckles to the lower right. Swept seven candidates in one run
  // (tools/qa/electron-flat-grip-sweep.js) and this is the one where the palm lies
  // on the sponge with the fingers across it. Rolling the wrist instead (z = -1.3
  // or +1.3) puts the hand on its edge, which is worse.
  flat: new THREE.Euler(0.42, 0.28, 0.02),
  hook: new THREE.Euler(1.02, 0.24, 0.04),
  pinch: new THREE.Euler(0.34, 0.22, 0.04),
};
const GRIP_ALIGN = {};
function rebuildGripAlign() {
  for (const [name, euler] of Object.entries(REST_TARGET)) {
    GRIP_ALIGN[name] = AUTHORED_GRIP_REST_INV.clone().multiply(new THREE.Quaternion().setFromEuler(euler));
  }
}
rebuildGripAlign();

// A grip's rest orientation is the hardest number in this file to reason about
// — it is a hand orientation expressed in a tool frame that is itself defined
// by a builder convention — and every one of them was found by looking at the
// screen, not by deriving it. So make that loop cheap: a driver can sweep
// candidates in ONE Electron run instead of one run per guess.
export function setGripRestTarget(pose, x, y, z) {
  if (!REST_TARGET[pose]) return null;
  REST_TARGET[pose].set(x, y, z);
  rebuildGripAlign();
  return { pose, x, y, z };
}
// A per-pose nudge that lands the palm SURFACE (not the wrist origin) on the socket, in hand-local
// coordinates so it rides the grip orientation.
const PALM_OFFSET = {
  wrap: [0, -0.012, 0.02],
  trigger: [0, -0.010, 0.02],
  flat: [0, -0.016, 0.03],
  hook: [0, -0.014, 0.02],
  pinch: [0, -0.008, 0.015],
};

// The ≥28° arm clamp: a forearm aimed within 28° of the view axis shows the sleeve end-on as a flat
// green disc. When a grip would do that, swing the arm toward the screen's lower edge and its own
// side instead. The tool group rides the camera, so its +Z is a good stand-in for "toward camera".
const CUFF_MIN_COS = Math.cos((28 * Math.PI) / 180);

// Scratch, reused every frame the hands re-sync onto their (possibly animated) sockets.
const _qSock = new THREE.Quaternion();
const _qHand = new THREE.Quaternion();
const _qCorr = new THREE.Quaternion();
const _eCorr = new THREE.Euler();
const _fwd = new THREE.Vector3();
const _palm = new THREE.Vector3();

function orientHand(hand, grip, poseName, mirror) {
  const align = GRIP_ALIGN[poseName] || GRIP_ALIGN.wrap;
  _qSock.set(grip.quat[0], grip.quat[1], grip.quat[2], grip.quat[3]);
  _qHand.copy(_qSock).multiply(align);
  // ≥28° cuff clamp against the group's +Z (toward-camera) axis.
  _fwd.set(0, 0, 1).applyQuaternion(_qHand);
  if (_fwd.z > CUFF_MIN_COS) {
    const add = Math.acos(CUFF_MIN_COS) - Math.acos(Math.min(1, _fwd.z)) + 0.03;
    _qCorr.setFromEuler(_eCorr.set(0.35 * add, 0.92 * add * mirror, 0));
    _qHand.premultiply(_qCorr);
  }
  const off = PALM_OFFSET[poseName] || PALM_OFFSET.wrap;
  _palm.set(off[0], off[1], off[2]).applyQuaternion(_qHand);
  hand.group.position.set(grip.pos[0] + _palm.x, grip.pos[1] + _palm.y, grip.pos[2] + _palm.z);
  hand.group.quaternion.copy(_qHand);
}

// How a hand closes. `curl` drives the finger chain, `thumb` the thumb, `spread` the fan across
// the knuckles, and `index` lets one finger stay out on a trigger while the rest wrap.
export const POSES = {
  // A8: closed HARDER round a shaft. At 1.18 the chain bent ~156 deg total, which lays
  // the fingers along the top of a handle rather than round it - on screen the shaft ran
  // in front of the fingertips and the hand read as resting on the pole, not gripping it.
  // The reference the player supplied has the fingers meeting the palm on the far side
  // with the thumb crossing over them. ~177 deg does that, and the thumb comes up to match.
  wrap: { curl: 1.34, thumb: 1.06, spread: 0.025, index: 1.30 }, // a shaft or a handle
  trigger: { curl: 1.08, thumb: 0.78, spread: 0.022, index: 0.30 }, // finger on the trigger
  // ITEM 9: at curl 0.46 the fingers barely bend, so once the palm was lifted
  // clear of the sponge they stood straight up off it and the hand read as
  // waving rather than holding. A hand on a pad drapes over its front edge.
  flat: { curl: 0.94, thumb: 0.84, spread: 0.010, index: 0.88 }, // fingers draped over a cloth pad
  hook: { curl: 1.06, thumb: 1.05, spread: 0.006, index: 1.02 }, // curled through the neck of a bag
  pinch: { curl: 0.60, thumb: 1.00, spread: 0.02, index: 0.55 },
};

// Non-cleaning tools that still want hands. Cleaning tools come from the registry.
const LEGACY_GRIPS = {
  hose: {
    grip: { pos: [0.0, -0.09, 0.12], rot: [-0.6, 0, 0], pose: 'trigger' },
    support: null,
    recoil: 0.02,
  },
  rake: {
    grip: { pos: [0.03, -0.05, 0.28], rot: [-0.9, 0, 0.1], pose: 'wrap' },
    support: { pos: [-0.04, 0.06, -0.16], rot: [-1.1, 0, -0.15], pose: 'wrap' },
    recoil: 0.03,
  },
  divot: {
    grip: { pos: [0.02, -0.06, 0.16], rot: [-0.8, 0, 0.08], pose: 'wrap' },
    support: null,
    recoil: 0.025,
  },
  // Checkout reuses the same hands as every other first-person verb. The mount
  // follows the pointer; these poses only describe whether one hand pinches a
  // card/note or both hands cradle a product/carrier.
  checkoutPinch: {
    grip: { pos: [0.012, -0.008, 0.0], rot: [0.72, -0.08, 0.08] },
    support: null,
    recoil: 0.026,
  },
  checkoutCarry: {
    grip: { pos: [0.055, -0.012, 0.015], rot: [0.72, -0.10, 0.16] },
    support: { pos: [-0.055, -0.012, 0.015], rot: [0.72, 0.10, -0.16] },
    recoil: 0.035,
  },
};

// Cleaning tools declare their grips in the registry; fold them in under the same shape.
function buildGripTable() {
  const table = { ...LEGACY_GRIPS };
  for (const def of Object.values(CLEANING_TOOLS)) {
    table[def.id] = {
      grip: { ...def.grip, pose: def.grip.pose || defaultPoseFor(def) },
      support: def.support ? { ...def.support, pose: def.support.pose || 'wrap' } : null,
      recoil: def.recoil ?? 0.02,
    };
  }
  return table;
}

function defaultPoseFor(def) {
  if (def.toolClass === 'jet' || def.toolClass === 'spray') return 'trigger';
  if (def.toolClass === 'carry') return 'hook';
  // a cloth or a sponge is held under a flat palm; everything else is a shaft
  if (def.id === 'cloth' || def.id === 'sponge') return 'flat';
  return 'wrap';
}

export const GRIPS = buildGripTable();

// --- one hand ----------------------------------------------------------------------------------

// A finger is two segments hinged at the knuckle, so it can actually close around something
// instead of being a single rotated slab.
function makeFinger(mats, len, thick, skinMat, withNail) {
  const skin = skinMat || mats.skin;
  const root = new THREE.Group();
  const prox = new THREE.Mesh(
    new THREE.CapsuleGeometry(thick * 0.47, Math.max(0.002, len * 0.56 - thick), 4, 12), skin,
  );
  prox.rotation.x = Math.PI / 2;
  prox.position.z = -len * 0.28;
  root.add(prox);

  const knuckle = new THREE.Group();
  knuckle.position.z = -len * 0.56;
  root.add(knuckle);

  const dist = new THREE.Mesh(
    new THREE.CapsuleGeometry(thick * 0.43, Math.max(0.002, len * 0.44 - thick), 4, 12), mats.shade,
  );
  dist.rotation.x = Math.PI / 2;
  dist.position.z = -len * 0.22;
  knuckle.add(dist);

  // A lighter flattened nail on the back of the fingertip separates index/middle from the rest.
  if (withNail) {
    const nail = new THREE.Mesh(new THREE.BoxGeometry(thick * 0.62, 0.0028, len * 0.20), mats.nail);
    nail.position.set(0, thick * 0.40, -len * 0.34);
    knuckle.add(nail);
  }

  return { root, knuckle };
}

function makeHand(mats, mirror = 1) {
  const g = new THREE.Group();
  const fingerSkins = mats.fingerSkins || [mats.skin, mats.skin, mats.skin, mats.skin];

  // The forearm is deliberately SHORT. It runs back toward the camera and would otherwise punch
  // straight through the near plane and fill the screen with a tan cylinder — which is exactly
  // what the first draft did. Slightly tapered so it reads as an arm, not a pipe.
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.037, 0.11, 12), mats.skin);
  forearm.rotation.x = Math.PI / 2;
  forearm.position.z = 0.072;
  g.add(forearm);

  // The polo sleeve. A plain cylinder showed its flat end-disc as a green coin whenever the arm
  // pointed near the camera. It is now a small assembly under one unrotated group so a single
  // `.visible` still hides it (the box cutter): a flared cylinder, a rolled torus at the opening
  // rim, and a dark inner disc just inside — so any angle reads as a rolled-up cuff with depth.
  const sleeve = new THREE.Group();
  sleeve.position.z = 0.138;
  const sleeveBody = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.038, 0.05, 12), mats.cuff);
  sleeveBody.rotation.x = Math.PI / 2;
  sleeve.add(sleeveBody);
  const cuffRoll = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.012, 8, 18), mats.cuff);
  cuffRoll.position.z = 0.024; // at the opening rim, toward the camera; torus axis already faces +Z
  sleeve.add(cuffRoll);
  const cuffInner = new THREE.Mesh(new THREE.CircleGeometry(0.036, 18), mats.cuffDark);
  cuffInner.position.z = 0.020;
  sleeve.add(cuffInner);
  g.add(sleeve);

  // D2: THE BACK OF THE HAND IS WHAT YOU ACTUALLY LOOK AT, AND IT WAS AN EGG.
  //
  // "Lower hand reads as an ovoid with a thumb." The two hands are the same
  // mesh; what differs is the roll about the shaft (broomFeel handRollUpper
  // 0.10 vs handRollLower -2.95, i.e. nearly half a turn). The upper hand shows
  // its fingers and reads as a fist; the lower one presents its DORSUM, and the
  // dorsum had no features at all — one smooth ellipsoid with the knuckle bumps
  // buried inside it. Measured against the old ellipsoid, the middle knuckle
  // cleared the palm surface by 0.003 yd: three pixels at the distance a hand
  // is actually viewed from.
  //
  // A back of a hand reads from three things, in this order: it is FLAT rather
  // than round, the metacarpals run as ridges from wrist to knuckles, and the
  // knuckle line breaks the silhouette. All three below.
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), mats.skin);
  palm.scale.set(0.96, 0.44, 1.06); // flatter and a touch wider — a slab, not an egg
  palm.position.set(0, 0, 0.012);
  g.add(palm);

  // The thenar mound at the thumb base fills the hollow the old flat mitt left between thumb and palm.
  const thenar = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), mats.skin);
  thenar.scale.set(1.15, 0.72, 1.35);
  thenar.position.set(0.03 * mirror, -0.006, -0.004);
  g.add(thenar);

  // …and the hypothenar on the pinky side, which was simply missing. Without it
  // the silhouette is one symmetrical oval; with it the hand has the two lobes
  // and the narrowing toward the wrist that say "hand" before any detail does.
  const hypothenar = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), mats.skin);
  hypothenar.scale.set(0.95, 0.78, 1.5);
  hypothenar.position.set(-0.030 * mirror, -0.004, 0.016);
  g.add(hypothenar);

  // The knuckle row is an ARC, not a straight line: the middle knuckle stands
  // most distal and the pinky's sits well back. Applied to the finger roots and
  // their bumps together so the two cannot separate.
  const KNUCKLE_Z = -0.033;
  const knuckleArc = [-0.002, -0.004, -0.001, 0.005]; // index, middle, ring, pinky
  const RIDGE_Y = 0.016; // dorsal side; the palm's own half-height is now 0.022
  const RIDGE_R = 0.008; // I4: was 0.0065 - crested the palm by ~0.0005 and read flat

  // four fingers across the knuckle line, index outermost on the thumb side
  const fingers = [];
  const lens = [0.070, 0.076, 0.072, 0.062];
  for (let i = 0; i < 4; i++) {
    const kx = (0.0285 - i * 0.019) * mirror;
    const kz = KNUCKLE_Z + knuckleArc[i];
    const f = makeFinger(mats, lens[i], 0.019, fingerSkins[i], i === 0 || i === 1);
    f.root.position.set(kx, -0.004, kz - 0.007);
    g.add(f.root);
    fingers.push(f);
    // a knuckle-ridge bump at each finger root, on the back of the hand. Raised
    // and enlarged so it CRESTS the flattened palm instead of sitting inside it.
    const knuckleBump = new THREE.Mesh(new THREE.SphereGeometry(0.0145, 8, 6), fingerSkins[i]);
    knuckleBump.scale.set(1, 0.78, 1);
    knuckleBump.position.set(kx, 0.013, kz); // I4: crest 0.024 vs palm top 0.022 - proud for real
    g.add(knuckleBump);

    // The metacarpal running back from that knuckle toward the wrist. These are
    // what turn a flat slab into a back of a hand — four soft parallel ridges
    // converging slightly as they go, catching light along their length.
    const wx = kx * 0.5;
    const wz = 0.034;
    const run = Math.hypot(kx - wx, kz - wz);
    const meta = new THREE.Group();
    meta.position.set((kx + wx) / 2, RIDGE_Y, (kz + wz) / 2);
    meta.rotation.y = Math.atan2(kx - wx, kz - wz);
    const bone = new THREE.Mesh(
      new THREE.CapsuleGeometry(RIDGE_R, Math.max(0.002, run - RIDGE_R * 2), 4, 10),
      fingerSkins[i],
    );
    bone.rotation.x = Math.PI / 2;
    meta.add(bone);
    g.add(meta);
  }

  const thumb = new THREE.Group();
  const thumbProx = new THREE.Mesh(new THREE.CapsuleGeometry(0.010, 0.022, 4, 12), mats.skin);
  thumbProx.rotation.x = Math.PI / 2;
  thumbProx.position.z = -0.021;
  thumb.add(thumbProx);
  const thumbKnuckle = new THREE.Group();
  thumbKnuckle.position.z = -0.042;
  thumb.add(thumbKnuckle);
  const thumbDist = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.016, 4, 12), mats.shade);
  thumbDist.rotation.x = Math.PI / 2;
  thumbDist.position.z = -0.017;
  thumbKnuckle.add(thumbDist);
  thumb.position.set(0.046 * mirror, -0.004, -0.012);
  g.add(thumb);

  g.scale.set(0.88 * mirror, 0.88, 0.88);

  // Apply a pose by rotating the joints. Nothing is rebuilt; a grip change is a few euler writes.
  function pose(name) {
    const p = POSES[name] || POSES.wrap;
    for (let i = 0; i < 4; i++) {
      const f = fingers[i];
      const amount = i === 0 ? p.index : p.curl;
      // the outer fingers close a touch harder — a real hand does not curl as one plate
      const bias = 1 + (i - 1.5) * 0.045;
      f.root.rotation.x = 1.05 * amount * bias;
      f.knuckle.rotation.x = 1.25 * amount * bias;
      f.root.rotation.y = (i - 1.5) * p.spread * mirror;
    }
    thumb.rotation.set(0.55 * p.thumb, -0.95 * p.thumb * mirror, -0.35 * mirror);
    thumbKnuckle.rotation.x = 0.72 * p.thumb;
  }

  pose('wrap');
  return { group: g, pose, forearm, sleeve };
}

export function makeFpHands() {
  const mats = {
    skin: new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.72 }),
    shade: new THREE.MeshStandardMaterial({ color: SKIN_SHADE, roughness: 0.78 }),
    cuff: new THREE.MeshStandardMaterial({ color: CUFF, roughness: 0.78 }),
    cuffDark: new THREE.MeshStandardMaterial({ color: CUFF_DARK, roughness: 0.85 }),
    nail: new THREE.MeshStandardMaterial({ color: NAIL, roughness: 0.5 }),
  };
  // Per-finger lightness variants (±3%) so adjacent fingers read as separate volumes, not one plate.
  mats.fingerSkins = [];
  for (let i = 0; i < 4; i++) {
    const variant = mats.skin.clone();
    const hsl = { h: 0, s: 0, l: 0 };
    variant.color.getHSL(hsl);
    variant.color.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * (1 + (i - 1.5) * 0.02))));
    mats.fingerSkins.push(variant);
  }

  const root = new THREE.Group();
  root.name = 'FirstPersonHands';
  const right = makeHand(mats, 1);
  const left = makeHand(mats, -1);
  right.group.name = 'FirstPersonRightHand';
  left.group.name = 'FirstPersonLeftHand';
  right.forearm.name = 'FirstPersonRightForearm';
  right.sleeve.name = 'FirstPersonRightCuff';
  left.forearm.name = 'FirstPersonLeftForearm';
  left.sleeve.name = 'FirstPersonLeftCuff';
  root.add(right.group, left.group);
  root.visible = false;

  let tool = null;
  let pose = null;
  let show = 0; // 0..1, hands rising into frame
  let recoil = 0; // 0..1, decays
  let breathe = 0;
  // Phase 6: a full-arm rig (the broom's viewmodel) replaces the short stub
  // forearm + cuff; while it owns the frame the stubs stay hidden.
  let armStubsSuppressed = false;
  // B4: some tools are DRAWN BARE - the tool sits in view with no hand on it.
  // Declared per tool by `hands: false` in the registry, which is the single
  // source; this flag is just how that reaches the hand rig. It is applied on
  // top of the normal visibility rules rather than replacing them, so nothing
  // else has to know about it and clearing it restores whatever the grip logic
  // wanted.
  let handsSuppressed = false;
  let savedVisibility = null;

  // What the held RIG should do because of the trigger. The caller owns heldRoot; writing recoil
  // here would slide the hands along the tool they are gripping.
  const rigOffset = { back: 0, pitch: 0, jitterX: 0 };

  function applyGrips(authored, updatePose) {
    if (!tool) return;
    const g = GRIPS[tool];
    const primary = authored?.grip || g.grip;
    const support = authored?.support === undefined ? g.support : authored.support;
    const primaryPose = primary.pose || g.grip.pose || 'wrap';
    left.group.visible = !!support && !handsSuppressed;

    // Position AND orientation update every frame so the hands ride live (equip/work) sockets. When
    // a grip carries an authored quaternion, the palm orientation is derived from it; otherwise the
    // legacy entryPitch heuristic still serves the non-authored tools (hose, rake, box cutter…).
    if (primary.quat) {
      orientHand(right, primary, primaryPose, 1);
    } else {
      right.group.position.set(...primary.pos);
      // A camera-facing cuff reads as a green disc and hides the fingers, so the arm enters toward a
      // lower screen edge rather than straight down the view axis.
      const entryPitch = primaryPose === 'flat' ? 0.82
        : primaryPose === 'hook' ? 0.64
          : primaryPose === 'trigger' ? 0.50 : 0.34;
      right.group.rotation.set(entryPitch, 0.22, (primary.rot?.[2] || 0) - 0.06);
    }
    if (support) {
      const supportPose = support.pose || g.support?.pose || 'wrap';
      if (support.quat) {
        orientHand(left, support, supportPose, -1);
      } else {
        left.group.position.set(...support.pos);
        left.group.rotation.set(0.32, -0.22, (support.rot?.[2] || 0) + 0.06);
      }
    }
    // Finger curl is a pose change, not a per-frame follow: only re-pose on an actual grip change.
    if (!updatePose) return;
    right.pose(primaryPose);
    if (support) left.pose(support.pose || g.support?.pose || 'wrap');
  }

  return {
    root,
    rigOffset,

    // which tool are we holding? null puts the hands away.
    setTool(next, authored = null) {
      tool = GRIPS[next] ? next : null;
      if (!tool) return;
      const g = GRIPS[tool];
      pose = g;
      root.scale.setScalar(g.handScale || 1);
      right.forearm.visible = !armStubsSuppressed;
      right.sleeve.visible = !armStubsSuppressed;
      applyGrips(authored, true);
    },

    // A full-arm viewmodel may want the hands read at a different size from the
    // held-out-at-arm's-length default. Scales the HAND GROUPS, preserving each
    // one's mirror; the root is left alone because callers subtract its
    // position when seating a hand on a solved grip, and scaling it there would
    // move every one of those seats.
    setHandScale(scale) {
      const value = Number.isFinite(scale) && scale > 0 ? scale : 1;
      const base = 0.88;
      right.group.scale.set(base * value, base * value, base * value);
      left.group.scale.set(-base * value, base * value, base * value);
    },

    // B4: draw this tool BARE, with no hand on it. Both hand groups are hit
    // directly rather than only the root, because a viewmodel rig REPARENTS
    // `right.group`/`left.group` out of the root into its own group — hiding
    // the root alone would leave a rig-held hand on screen, which is exactly
    // the washer's case.
    // It must be SYMMETRIC. Forcing the groups hidden and then only clearing a
    // flag leaves them hidden for whatever tool comes next: the first version
    // of this took the hands off the mop, the vacuum and the dustpan as well,
    // and only the broom kept them because the broom happened to be equipped
    // before any bare tool was. So the previous visibility is saved and put
    // back, rather than guessed at on the way out.
    setHandsSuppressed(on) {
      const next = !!on;
      if (next === handsSuppressed) return;
      handsSuppressed = next;
      if (handsSuppressed) {
        savedVisibility = { right: right.group.visible, left: left.group.visible, root: root.visible };
        right.group.visible = false;
        left.group.visible = false;
        root.visible = false;
      } else if (savedVisibility) {
        right.group.visible = savedVisibility.right;
        left.group.visible = savedVisibility.left;
        root.visible = savedVisibility.root;
        savedVisibility = null;
      }
    },
    handsAreSuppressed: () => handsSuppressed,

    // Phase 6: hide/show the stub forearms + cuffs on BOTH hands while a
    // full-arm viewmodel rig owns them.
    setArmStubsVisible(on) {
      armStubsSuppressed = !on;
      for (const hand of [right, left]) {
        hand.forearm.visible = !!on;
        hand.sleeve.visible = !!on;
      }
    },

    // Authored equip/work clips animate the socket hierarchy after the tool is equipped. Keep
    // the hands on those live sockets instead of freezing their load-time positions.
    syncGrips(authored = null) {
      applyGrips(authored, false);
    },

    // the trigger went
    kick() {
      recoil = 1;
    },

    update(dt, using) {
      const want = tool ? 1 : 0;
      show += (want - show) * Math.min(1, dt * 9);
      // Retain the last valid pose while the hands ease below the camera. A
      // null tool starts the holster motion; it must not hide the rig in the
      // same frame and turn the authored lowering into a visual snap.
      root.visible = show > 0.01 && !!pose && !handsSuppressed;

      if (using) recoil = Math.min(1, recoil + dt * 7);
      else recoil = Math.max(0, recoil - dt * 5);

      breathe += dt;
      const g = pose || GRIPS.hose;

      // The rig kicks back and the muzzle climbs; the hands stay where they are gripping.
      rigOffset.back = recoil * (g.recoil || 0.02);
      rigOffset.pitch = recoil * -0.06;
      rigOffset.jitterX = using ? Math.sin(breathe * 46) * 0.004 * recoil : 0;

      if (!root.visible) return;
      // Hand-local motion is only what the hands themselves do: a slow breathe, and a slight
      // tightening of the grip while the tool is working.
      const rise = (1 - show) * 0.34;
      const idle = Math.sin(breathe * 1.7) * 0.004 + Math.sin(breathe * 0.9) * 0.0025;
      root.position.set(0, -rise + idle, 0);
      root.rotation.z = Math.sin(breathe * 1.1) * 0.008;
    },

    dispose() {
      for (const m of Object.values(mats)) {
        if (Array.isArray(m)) for (const v of m) v.dispose();
        else m.dispose();
      }
      root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    },

    getState() {
      return { visible: root.visible, tool, show, recoil };
    },

  };
}

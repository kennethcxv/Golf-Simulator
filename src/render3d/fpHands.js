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
  flat: new THREE.Euler(1.12, 0.20, 0.02),
  hook: new THREE.Euler(1.02, 0.24, 0.04),
  pinch: new THREE.Euler(0.34, 0.22, 0.04),
};
const GRIP_ALIGN = {};
for (const [name, euler] of Object.entries(REST_TARGET)) {
  GRIP_ALIGN[name] = AUTHORED_GRIP_REST_INV.clone().multiply(new THREE.Quaternion().setFromEuler(euler));
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
  wrap: { curl: 1.18, thumb: 0.92, spread: 0.025, index: 1.15 }, // a shaft or a handle
  trigger: { curl: 1.08, thumb: 0.78, spread: 0.022, index: 0.30 }, // finger on the trigger
  flat: { curl: 0.46, thumb: 0.52, spread: 0.008, index: 0.42 }, // fingers draped over a cloth pad
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

  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), mats.skin);
  palm.scale.set(0.9, 0.52, 1.08);
  palm.position.set(0, 0, 0.012);
  g.add(palm);

  // The thenar mound at the thumb base fills the hollow the old flat mitt left between thumb and palm.
  const thenar = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), mats.skin);
  thenar.scale.set(1.15, 0.72, 1.35);
  thenar.position.set(0.03 * mirror, -0.006, -0.004);
  g.add(thenar);

  // four fingers across the knuckle line, index outermost on the thumb side
  const fingers = [];
  const lens = [0.070, 0.076, 0.072, 0.062];
  for (let i = 0; i < 4; i++) {
    const f = makeFinger(mats, lens[i], 0.019, fingerSkins[i], i === 0 || i === 1);
    f.root.position.set((0.0285 - i * 0.019) * mirror, -0.004, -0.040);
    g.add(f.root);
    fingers.push(f);
    // a knuckle-ridge bump at each finger root, on the back of the hand
    const knuckleBump = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 8, 6), fingerSkins[i]);
    knuckleBump.scale.set(1, 0.8, 1);
    knuckleBump.position.set((0.0285 - i * 0.019) * mirror, 0.007, -0.033);
    g.add(knuckleBump);
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

  // What the held RIG should do because of the trigger. The caller owns heldRoot; writing recoil
  // here would slide the hands along the tool they are gripping.
  const rigOffset = { back: 0, pitch: 0, jitterX: 0 };

  function applyGrips(authored, updatePose) {
    if (!tool) return;
    const g = GRIPS[tool];
    const primary = authored?.grip || g.grip;
    const support = authored?.support === undefined ? g.support : authored.support;
    const primaryPose = primary.pose || g.grip.pose || 'wrap';
    left.group.visible = !!support;

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
      root.visible = show > 0.01 && !!pose;

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

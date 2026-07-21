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

// How a hand closes. `curl` drives the finger chain, `thumb` the thumb, `spread` the fan across
// the knuckles, and `index` lets one finger stay out on a trigger while the rest wrap.
export const POSES = {
  wrap: { curl: 1.18, thumb: 0.92, spread: 0.025, index: 1.15 }, // a shaft or a handle
  trigger: { curl: 1.08, thumb: 0.78, spread: 0.022, index: 0.30 }, // finger on the trigger
  flat: { curl: 0.20, thumb: 0.34, spread: 0.018, index: 0.16 }, // palm down on a cloth
  hook: { curl: 0.96, thumb: 1.00, spread: 0.018, index: 0.92 }, // the neck of a bag
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
  // held low and forward, the way you hold a knife you are about to draw toward you down a seam
  boxcutter: {
    grip: { pos: [0.026, -0.012, 0.110], rot: [-0.12, 0, 0.10], pose: 'pinch' },
    support: null,
    recoil: 0.06,
    handScale: 0.78,
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
function makeFinger(mats, len, thick) {
  const root = new THREE.Group();
  const prox = new THREE.Mesh(
    new THREE.CapsuleGeometry(thick * 0.47, Math.max(0.002, len * 0.56 - thick), 4, 7), mats.skin,
  );
  prox.rotation.x = Math.PI / 2;
  prox.position.z = -len * 0.28;
  root.add(prox);

  const knuckle = new THREE.Group();
  knuckle.position.z = -len * 0.56;
  root.add(knuckle);

  const dist = new THREE.Mesh(
    new THREE.CapsuleGeometry(thick * 0.43, Math.max(0.002, len * 0.44 - thick), 4, 7), mats.shade,
  );
  dist.rotation.x = Math.PI / 2;
  dist.position.z = -len * 0.22;
  knuckle.add(dist);

  return { root, knuckle };
}

function makeHand(mats, mirror = 1) {
  const g = new THREE.Group();

  // The forearm is deliberately SHORT. It runs back toward the camera and would otherwise punch
  // straight through the near plane and fill the screen with a tan cylinder — which is exactly
  // what the first draft did.
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.037, 0.11, 10), mats.skin);
  forearm.rotation.x = Math.PI / 2;
  forearm.position.z = 0.072;
  g.add(forearm);

  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.037, 0.046, 10), mats.cuff);
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.z = 0.137;
  g.add(sleeve);

  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mats.skin);
  palm.scale.set(0.88, 0.50, 1.06);
  palm.position.set(0, 0, 0.012);
  g.add(palm);

  // four fingers across the knuckle line, index outermost on the thumb side
  const fingers = [];
  const lens = [0.070, 0.076, 0.072, 0.062];
  for (let i = 0; i < 4; i++) {
    const f = makeFinger(mats, lens[i], 0.019);
    f.root.position.set((0.0285 - i * 0.019) * mirror, -0.004, -0.040);
    g.add(f.root);
    fingers.push(f);
  }

  const thumb = new THREE.Group();
  const thumbProx = new THREE.Mesh(new THREE.CapsuleGeometry(0.010, 0.022, 4, 7), mats.skin);
  thumbProx.rotation.x = Math.PI / 2;
  thumbProx.position.z = -0.021;
  thumb.add(thumbProx);
  const thumbKnuckle = new THREE.Group();
  thumbKnuckle.position.z = -0.042;
  thumb.add(thumbKnuckle);
  const thumbDist = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.016, 4, 7), mats.shade);
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
    skin: new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.82 }),
    shade: new THREE.MeshStandardMaterial({ color: SKIN_SHADE, roughness: 0.84 }),
    cuff: new THREE.MeshStandardMaterial({ color: CUFF, roughness: 0.9 }),
  };

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

  // What the held RIG should do because of the trigger. The caller owns heldRoot; writing recoil
  // here would slide the hands along the tool they are gripping.
  const rigOffset = { back: 0, pitch: 0, jitterX: 0 };

  function applyGrips(authored, updatePose) {
    if (!tool) return;
    const g = GRIPS[tool];
    const primary = authored?.grip || g.grip;
    const support = authored?.support === undefined ? g.support : authored.support;
    right.group.position.set(...primary.pos);
    left.group.visible = !!support;
    if (support) left.group.position.set(...support.pos);
    if (!updatePose) return;

    // Sockets place the palm on the tool. The arm must then travel toward a lower screen edge,
    // not straight down the camera axis: a camera-facing cuff reads as a giant green disc and
    // hides the fingers. Grip pose controls the curl; these biases control where the arm enters.
    const primaryPose = primary.pose || g.grip.pose || 'wrap';
    const entryPitch = primaryPose === 'flat' ? 0.82
      : primaryPose === 'hook' ? 0.64
        : primaryPose === 'trigger' ? 0.50 : 0.34;
    if (tool === 'boxcutter') right.group.rotation.set(...primary.rot);
    else right.group.rotation.set(entryPitch, 0.22, (primary.rot?.[2] || 0) - 0.06);
    right.pose(primary.pose || g.grip.pose || 'wrap');
    if (support) {
      left.group.rotation.set(0.32, -0.22, (support.rot?.[2] || 0) + 0.06);
      left.pose(support.pose || g.support?.pose || 'wrap');
    }
  }

  return {
    root,
    rigOffset,

    // which tool are we holding? null puts the hands away.
    setTool(next, authored = null) {
      tool = GRIPS[next] ? next : null;
      if (!tool) return;
      const g = GRIPS[tool];
      root.scale.setScalar(g.handScale || 1);
      // The cutter travels onto a world-space seam. Its normal camera-local
      // forearm is replaced there by the bent arm bridge in courseScene.
      right.forearm.visible = tool !== 'boxcutter';
      right.sleeve.visible = tool !== 'boxcutter';
      right.group.position.set(...g.grip.pos);
      right.group.rotation.set(...g.grip.rot);
      right.pose(g.grip.pose || 'wrap');
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
      root.visible = show > 0.01 && !!tool;

      if (using) recoil = Math.min(1, recoil + dt * 7);
      else recoil = Math.max(0, recoil - dt * 5);

      breathe += dt;
      const g = GRIPS[tool] || GRIPS.hose;

      // The rig kicks back and the muzzle climbs; the hands stay where they are gripping.
      rigOffset.back = recoil * (g.recoil || 0.02);
      rigOffset.pitch = recoil * -0.06;
      rigOffset.jitterX = using ? Math.sin(breathe * 46) * 0.004 * recoil : 0;

      if (!root.visible) return;
      // Hand-local motion is only what the hands themselves do: a slow breathe, and a slight
      // tightening of the grip while the tool is working.
      const idle = Math.sin(breathe * 1.7) * 0.004 + Math.sin(breathe * 0.9) * 0.0025;
      root.position.set(0, idle, 0);
      root.rotation.z = Math.sin(breathe * 1.1) * 0.008;
    },

    getState() {
      return { visible: root.visible, tool, show, recoil };
    },

    dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const materials = Array.isArray(o.material) ? o.material : [o.material];
          for (const material of materials) material.dispose();
        }
      });
    },
  };
}

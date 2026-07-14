// FIRST-PERSON HANDS — somebody is holding the thing.
//
// The tools were floating: a pressure-washer lance with a jet and a motor and nobody on the
// trigger, a vacuum wand steering itself. This is the shared rig — one pair of hands, and a grip
// pose per tool that says where they go and how they sit — so a new tool declares its grip instead
// of a new pair of hands being modelled for it.
//
// Everything here is procedural and stylised to match the rest of the shop: readable silhouettes,
// bevelled forms, no attempt at knuckles. What sells it is not the geometry, it is the motion —
// the hands rise into frame when you equip, settle, breathe, and shove back when the trigger goes.

import * as THREE from 'three';

const SKIN = 0xd9a97e;
const CUFF = 0x2f4a35; // the club's own polo green, at the wrist

// Where the hands sit for each tool, in the held-tool's local frame.
// `grip` is the driving hand (trigger / wand), `support` the other one (null = one-handed).
export const GRIPS = {
  // the washer's handle sits at (0, -0.16, 0.20) in its own frame and the lance runs out to -z,
  // so the trigger hand wraps the handle and the support hand rides the shaft ahead of it
  washer: {
    grip: { pos: [0.0, -0.13, 0.20], rot: [-0.35, 0, 0.12] },
    support: { pos: [0.0, 0.015, -0.30], rot: [-0.30, 0, 0.9] },
    recoil: 0.055, // the lance shoves back when the trigger goes
  },
  vacuum: {
    grip: { pos: [0.0, -0.1, 0.16], rot: [-0.65, 0, 0.05] },
    support: null,
    recoil: 0.012,
  },
  hose: {
    grip: { pos: [0.0, -0.09, 0.12], rot: [-0.6, 0, 0] },
    support: null,
    recoil: 0.02,
  },
  rake: {
    grip: { pos: [0.03, -0.05, 0.28], rot: [-0.9, 0, 0.1] },
    support: { pos: [-0.04, 0.06, -0.16], rot: [-1.1, 0, -0.15] },
    recoil: 0.03,
  },
  divot: {
    grip: { pos: [0.02, -0.06, 0.16], rot: [-0.8, 0, 0.08] },
    support: null,
    recoil: 0.025,
  },
};

// one hand: forearm, palm, a thumb, and a mitt of fingers. Read at arm's length, not inspected.
function makeHand(mirror = 1) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.82 });
  const cuff = new THREE.MeshStandardMaterial({ color: CUFF, roughness: 0.9 });

  // The forearm is deliberately SHORT. It runs back toward the camera and would otherwise punch
  // straight through the near plane and fill the screen with a tan cylinder — which is exactly
  // what the first draft did.
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.050, 0.16, 10), skin);
  forearm.rotation.x = Math.PI / 2;
  forearm.position.z = 0.10;
  g.add(forearm);

  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.054, 0.055, 10), cuff);
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.z = 0.175;
  g.add(sleeve);

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.048, 0.10), skin);
  palm.position.set(0, 0, 0.01);
  g.add(palm);

  // the fingers as one curled mitt: four knuckles, wrapped forward
  const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.075, 0.05), skin);
  fingers.position.set(0, -0.028, -0.035);
  fingers.rotation.x = 0.55;
  g.add(fingers);

  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.05, 3, 6), skin);
  thumb.position.set(0.045 * mirror, 0.012, -0.022);
  thumb.rotation.set(0.9, 0, -0.5 * mirror);
  g.add(thumb);

  g.scale.x = mirror;
  return g;
}

export function makeFpHands() {
  const root = new THREE.Group();
  const right = makeHand(1);
  const left = makeHand(-1);
  root.add(right, left);
  root.visible = false;

  let tool = null;
  let show = 0; // 0..1, hands rising into frame
  let recoil = 0; // 0..1, decays
  let breathe = 0;

  return {
    root,

    // which tool are we holding? null puts the hands away.
    setTool(next) {
      tool = GRIPS[next] ? next : null;
      if (!tool) return;
      const g = GRIPS[tool];
      right.position.set(...g.grip.pos);
      right.rotation.set(...g.grip.rot);
      left.visible = !!g.support;
      if (g.support) {
        left.position.set(...g.support.pos);
        left.rotation.set(...g.support.rot);
      }
    },

    // the trigger went: shove the hands (and the tool they are on) back
    kick() {
      recoil = 1;
    },

    update(dt, using) {
      const want = tool ? 1 : 0;
      show += (want - show) * Math.min(1, dt * 9);
      root.visible = show > 0.01 && !!tool;
      if (!root.visible) return;

      if (using) recoil = Math.min(1, recoil + dt * 7);
      else recoil = Math.max(0, recoil - dt * 5);

      breathe += dt;
      const g = GRIPS[tool] || GRIPS.hose;
      // hands ride up into frame on equip, breathe at rest, and shove back under load
      const rise = (1 - show) * 0.34;
      const idle = Math.sin(breathe * 1.7) * 0.006 + Math.sin(breathe * 0.9) * 0.004;
      const back = recoil * (g.recoil || 0.02);
      const jitter = using ? Math.sin(breathe * 46) * 0.004 * recoil : 0;

      root.position.set(jitter, -rise + idle, back);
      root.rotation.x = recoil * -0.06 + idle * 0.5;
      root.rotation.z = Math.sin(breathe * 1.1) * 0.01;
    },
  };
}

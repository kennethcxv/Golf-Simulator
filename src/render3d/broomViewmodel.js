// THE PHASE 6 BROOM — a held tool that belongs to a person.
//
// Phase 0's review failed the old broom for being "completely detached from
// the person… floating hands in front of it", phasing through furniture, and
// dying when you look down. Phase 1 traced five causes; this module closes
// them in one place, driven entirely by src/data/broomFeel.js:
//
//   1. ARMS. Real forearms run from each gripping hand to an off-frame elbow,
//      with a rolled sleeve at the elbow end — the arm ENTERS the frame the
//      way every first-person rig does, so there is no floating cuff disc and
//      no 0.11-yd stub.
//   2. A VIEWMODEL CAMERA. The broom renders in its own pass on its own layer
//      with its own lens (BROOM_FEEL.camera), after the world, with depth
//      cleared — the same pattern as the delivery-carry overlay — so the tool
//      is not hostage to the world FOV and cannot clip world geometry.
//   3. POSE FROM THE HANDS, NOT THE FLOOR PLANE. The head's reach follows the
//      view pitch through an eased curve (look down and the head comes in
//      toward the feet; look up past liftAbove and it lifts with you), and
//      the shaft pitch is SOLVED so the bristle line kisses the floor at that
//      reach — the contact point belongs to the kinematic chain, so it no
//      longer slides ~0.6 yd across the pitch range.
//   4. COLLISION. The head is clamped against the same collider set the
//      player walks against; a blocking face interrupts the stroke with a
//      standoff and reports its normal so the head tilts to the surface it is
//      actually working.
//   5. FEEL. Eased equip/unequip, stride-locked bob, idle sway, an eased
//      sub-2° camera response on contact, and a stroke intensity signal the
//      audio layers ride.
//
// The mop, vacuum and washer stay on the old path until the broom is
// approved — one tool sets the standard the others copy.

import * as THREE from 'three';
import { BROOM_FEEL } from '../data/broomFeel.js';

const SKIN = 0xd9a97e;
const CUFF = 0x2f4a35;
const CUFF_DARK = 0x21351f;

const _wrist = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _span = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _headWorld = new THREE.Vector3();
const _ndc = new THREE.Vector3();

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInCubic(t) { return t * t * t; }

// One arm, House Flipper proportions: a SHORT fixed-length skin forearm at
// the wrist (never stretched to cover distance), a rolled cuff at the elbow,
// and a sleeved upper segment that dives from the elbow to an off-frame
// shoulder anchor — the clothed arm carries the distance, so skin reads from
// roughly mid-forearm to the hand and nothing else.
function buildArm(mats, mirror) {
  const a = BROOM_FEEL.arms;
  const group = new THREE.Group();
  group.name = mirror > 0 ? 'BroomRightArm' : 'BroomLeftArm';

  // Object3D.lookAt points a plain object's +Z at its target, so both
  // segments are built along +Z with their pivot at the ELBOW.
  const forearm = new THREE.Mesh(
    new THREE.CapsuleGeometry(a.forearmRadius, a.forearmSpan, 6, 12), mats.skin,
  );
  forearm.rotation.x = Math.PI / 2;
  const forearmPivot = new THREE.Group();
  forearmPivot.add(forearm);
  forearm.position.z = a.forearmSpan / 2; // spans elbow (origin) -> wrist (+z)
  group.add(forearmPivot);

  // the rolled cuff wraps the elbow joint, aimed along the forearm; it is NOT
  // a child of the scaled pivot, so span adjustments never stretch the roll
  const cuff = new THREE.Group();
  const cuffRoll = new THREE.Mesh(
    new THREE.TorusGeometry(a.forearmRadius + 0.014, 0.015, 8, 18), mats.cuff,
  );
  cuffRoll.position.z = 0.045;
  cuff.add(cuffRoll);
  const cuffBody = new THREE.Mesh(
    new THREE.CylinderGeometry(a.forearmRadius + 0.010, a.sleeveRadius, 0.09, 12), mats.cuff,
  );
  cuffBody.rotation.x = Math.PI / 2;
  cuff.add(cuffBody);
  group.add(cuff);

  // the sleeve: elbow -> off-frame shoulder anchor
  const sleeve = new THREE.Mesh(
    new THREE.CapsuleGeometry(a.sleeveRadius, a.sleeveLength, 6, 12), mats.cuff,
  );
  sleeve.rotation.x = Math.PI / 2;
  const sleevePivot = new THREE.Group();
  sleevePivot.add(sleeve);
  sleeve.position.z = a.sleeveLength / 2;
  group.add(sleevePivot);

  for (const mesh of [forearm, cuffRoll, cuffBody, sleeve]) {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  }
  return { group, forearmPivot, cuff, sleevePivot };
}

/**
 * @param {object} deps
 * @param {THREE.PerspectiveCamera} deps.camera   the world camera (pose source)
 * @param {THREE.WebGLRenderer}     deps.renderer
 * @param {THREE.Scene}             deps.scene
 * @param {THREE.Group}             deps.broomGroup  heldGroups.broom
 * @param {object}                  deps.fpHands     makeFpHands() instance
 * @param {function}                deps.colliderQuery  (x, z, r) => { blocked, nx, nz } | null
 * @param {function}                deps.floorY      (x, z) => number|null
 */
export function createBroomViewmodel({
  camera, renderer, scene, broomGroup, fpHands, colliderQuery, floorY,
}) {
  const feel = BROOM_FEEL;
  const vmCamera = new THREE.PerspectiveCamera(
    feel.camera.fov, camera.aspect, feel.camera.near, feel.camera.far,
  );
  vmCamera.matrixAutoUpdate = false;
  vmCamera.layers.set(feel.camera.layer);

  const mats = {
    skin: new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.72 }),
    cuff: new THREE.MeshStandardMaterial({ color: CUFF, roughness: 0.78 }),
    cuffDark: new THREE.MeshStandardMaterial({ color: CUFF_DARK, roughness: 0.85 }),
  };
  const right = buildArm(mats, 1);
  const left = buildArm(mats, -1);
  broomGroup.add(right.group, left.group);
  right.group.visible = false;
  left.group.visible = false;

  // Arm anchors from the ONE tuning file. Elbows are WRIST-RELATIVE in camera
  // axes (right/up/toward-viewer), so the forearm enters foreshortened just
  // below its hand at every pose instead of stretching from a fixed corner;
  // shoulders are fixed camera-space points BELOW the frame edge, so the
  // sleeve always exits the frame clothed.
  const armCfg = feel.arms;
  const elbowOffsetRight = new THREE.Vector3(...armCfg.elbowOffsetRight);
  const elbowOffsetLeft = new THREE.Vector3(...armCfg.elbowOffsetLeft);
  const shoulderRight = new THREE.Vector3(...armCfg.shoulderRight);
  const shoulderLeft = new THREE.Vector3(...armCfg.shoulderLeft);
  const _elbowWorld = new THREE.Vector3();
  const _shoulderWorld = new THREE.Vector3();
  const _basisX = new THREE.Vector3();
  const _basisY = new THREE.Vector3();
  const _basisZ = new THREE.Vector3();

  let active = false;
  let reach = feel.frame.headForward;
  let tilt = 0;
  let tiltAxis = 0; // signed: which way the blocking face pushes the head
  let kick = 0; // 0..1 envelope of the camera response
  let intensity = 0; // 0..1 stroke intensity for audio/particles
  let clampedNow = false;
  let lastHeadNdc = { x: 0, y: 0 };
  const state = {};

  const layerOnRecursive = (root, on) => {
    root.traverse((object) => {
      if (on) object.layers.set(feel.camera.layer);
      else object.layers.set(0);
    });
  };

  function setActive(on) {
    if (active === !!on) return;
    active = !!on;
    right.group.visible = active;
    left.group.visible = active;
    // The full arms replace the stub forearm + cuff for the duration.
    fpHands.setArmStubsVisible?.(!active);
    // The broom (and the hands parented into it) leave the world pass
    // entirely while the viewmodel pass owns them.
    layerOnRecursive(broomGroup, active);
    if (!active) {
      // On a tool switch the hands may ALREADY be re-parented into the next
      // tool's group — sweep them back to the world layer wherever they live,
      // or the next tool is held by invisible hands.
      layerOnRecursive(fpHands.root, false);
      tilt = 0;
      kick = 0;
      intensity = 0;
    }
  }

  // Aim one arm: elbow just below its wrist (camera axes), skin forearm
  // spanning elbow -> wrist at ~authored length, cuff at the joint, and the
  // sleeve diving from the elbow to the off-frame shoulder anchor.
  function poseArm(arm, handGroup, elbowOffset, shoulderCam, stash) {
    handGroup.getWorldPosition(_wrist); // wrist, world
    camera.matrixWorld.extractBasis(_basisX, _basisY, _basisZ);
    _elbowWorld.copy(_wrist)
      .addScaledVector(_basisX, elbowOffset.x)
      .addScaledVector(_basisY, elbowOffset.y)
      .addScaledVector(_basisZ, elbowOffset.z);
    _shoulderWorld.copy(shoulderCam).applyMatrix4(camera.matrixWorld);
    _elbow.copy(_elbowWorld);
    broomGroup.worldToLocal(_elbow);
    arm.group.position.copy(_elbow);
    _span.copy(_wrist).sub(_elbowWorld);
    const length = Math.max(0.12, _span.length());
    arm.forearmPivot.lookAt(_wrist);
    arm.forearmPivot.scale.z = Math.max(
      armCfg.spanScaleMin, Math.min(armCfg.spanScaleMax, length / armCfg.forearmSpan),
    );
    arm.cuff.quaternion.copy(arm.forearmPivot.quaternion);
    arm.sleevePivot.lookAt(_shoulderWorld);
    arm.sleevePivot.scale.z = Math.max(0.5, _mid.copy(_shoulderWorld).sub(_elbowWorld).length() / armCfg.sleeveLength);
    if (stash) {
      stash.ex = _elbowWorld.x; stash.ey = _elbowWorld.y; stash.ez = _elbowWorld.z;
      stash.wx = _wrist.x; stash.wy = _wrist.y; stash.wz = _wrist.z;
      stash.spanYd = length;
    }
  }

  // Screen-space arm metrics for the proportion evidence: project elbow and
  // wrist through the viewmodel lens, clip the segment to the NDC box, and
  // report how much of the frame's height the visible run covers.
  const _pa = new THREE.Vector3();
  const _pb = new THREE.Vector3();
  function armScreenMetrics(stash) {
    if (!stash || stash.spanYd === undefined) return null;
    _pa.set(stash.ex, stash.ey, stash.ez).project(vmCamera);
    _pb.set(stash.wx, stash.wy, stash.wz).project(vmCamera);
    // visible parameter range of elbow->wrist inside |x|<=1, |y|<=1
    let t0 = 0; let t1 = 1;
    for (const axis of ['x', 'y']) {
      const a = _pa[axis]; const b = _pb[axis];
      const d = b - a;
      if (Math.abs(d) < 1e-6) {
        if (Math.abs(a) > 1) { t0 = 1; t1 = 0; }
        continue;
      }
      let lo = (-1 - a) / d; let hi = (1 - a) / d;
      if (lo > hi) { const swap = lo; lo = hi; hi = swap; }
      t0 = Math.max(t0, lo); t1 = Math.min(t1, hi);
    }
    const vis = Math.max(0, t1 - t0);
    return {
      elbowNdc: { x: +_pa.x.toFixed(3), y: +_pa.y.toFixed(3) },
      wristNdc: { x: +_pb.x.toFixed(3), y: +_pb.y.toFixed(3) },
      spanYd: +stash.spanYd.toFixed(3),
      visibleFrac: +vis.toFixed(3), // fraction of the arm segment on screen
      // fraction of the frame HEIGHT the visible run climbs (the number the
      // House Flipper comparison is made in)
      screenRunY: +((Math.abs(_pb.y - _pa.y) * vis) / 2).toFixed(3),
    };
  }

  function update(dt, ctx) {
    if (!active) return null;
    const {
      pitch = 0, using = false, moving = false, phase = 0, reducedMotion = false,
      speedNorm = 0,
    } = ctx;

    // --- reach follows pitch (eased) ---------------------------------------
    const p = feel.pitch;
    const clamped = Math.max(p.minPitch, Math.min(p.maxPitch, pitch));
    const t = (clamped - p.minPitch) / (p.maxPitch - p.minPitch); // 0 steep .. 1 horizon
    let wantReach = p.reachNear + (p.reachFar - p.reachNear) * easeOutCubic(t);
    const follow = reducedMotion ? 1 : Math.min(1, dt * p.followRate);
    reach += (wantReach - reach) * follow;

    // --- stroke offset: the WEIGHTED head -----------------------------------
    // The drawn head follows the stroke through an under-damped spring: it
    // lags each direction change, overshoots a touch, and settles rather than
    // snapping. The sim contact uses the SAME lagged value, so the cleaning
    // always lands where the bristles visibly are.
    const s = feel.stroke;
    const w = feel.weight;
    const jammed = clampedNow; // last frame's clamp state gates this frame's stroke drive
    const spanEff = s.span * (jammed ? feel.collision.stallSquash : 1);
    const strokeTarget = using ? Math.sin(phase) * spanEff : 0;
    if (state.lagX === undefined) { state.lagX = 0; state.lagV = 0; }
    if (reducedMotion) {
      state.lagX = strokeTarget; state.lagV = 0;
    } else {
      // semi-implicit spring, sub-stepped for stability on long frames
      const omega = 2 * Math.PI * w.lagHz;
      let remaining = Math.min(dt, 0.1);
      while (remaining > 0) {
        const h = Math.min(remaining, 1 / 120);
        state.lagV += (
          (strokeTarget - state.lagX) * omega * omega - 2 * w.lagDamping * omega * state.lagV
        ) * h;
        state.lagX += state.lagV * h;
        remaining -= h;
      }
    }
    const strokeX = state.lagX;
    const cosPhase = Math.cos(phase);
    const inContact = using && Math.abs(cosPhase) >= s.contactCos;
    let wantIntensity = using ? (inContact ? Math.abs(cosPhase) : 0.25) : 0;
    // sweeping on the move works harder: the pass covers more boards
    if (using) wantIntensity = Math.min(1, wantIntensity * (1 + w.speedBoost * speedNorm));
    if (jammed) wantIntensity *= feel.collision.stallIntensity;
    intensity += (wantIntensity - intensity) * Math.min(1, dt * 8);

    // head position in world XZ: camera + forward*reach + right*strokeX
    const yaw = ctx.yaw ?? 0;
    const fx = -Math.sin(yaw); const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw); const rz = -Math.sin(yaw);
    let headReach = reach;
    let nx = 0; let nz = 0;
    clampedNow = false;
    if (colliderQuery) {
      // pull the head in until the swept half-width sits standoff clear of a
      // blocking face; three bisection steps land within ~1 cm
      const c = feel.collision;
      const probe = (r) => colliderQuery(
        camera.position.x + fx * r + rx * strokeX,
        camera.position.z + fz * r + rz * strokeX,
        c.headHalfWidth,
      );
      const hitAtFull = probe(headReach + c.probeAhead);
      if (hitAtFull?.blocked) {
        clampedNow = true;
        nx = hitAtFull.nx || -fx; nz = hitAtFull.nz || -fz;
        let lo = 0.2; let hi = headReach;
        for (let step = 0; step < 4; step += 1) {
          const midReach = (lo + hi) / 2;
          if (probe(midReach)?.blocked) hi = midReach;
          else lo = midReach;
        }
        headReach = Math.max(0.2, lo - c.standoff);
      }
    }
    const slide = Math.min(1, dt * feel.collision.slideRate);
    state.drawReach = state.drawReach === undefined ? headReach
      : state.drawReach + (headReach - state.drawReach) * slide;

    // --- surface tilt -------------------------------------------------------
    const wantTilt = clampedNow ? feel.surface.tiltMax : 0;
    tilt += (wantTilt - tilt) * Math.min(1, dt * feel.surface.tiltRate);
    tiltAxis = clampedNow ? (nx * rx + nz * rz >= 0 ? 1 : -1) : tiltAxis;

    // --- pose the rig: CARRY blends into WORK -------------------------------
    // At level look the broom is CARRIED — shaft near horizontal, drawn head
    // raised into frame (a true floor contact 1.4 yd ahead sits ~49° below a
    // 50° lens; no honest pose shows it). As the view pitches down toward the
    // work, the pose blends into the PLANTED solve, where the drawn head and
    // the true contact are the same point — visual truth exactly where the
    // player is looking at it.
    const fy = floorY ? floorY(camera.position.x, camera.position.z) : null;
    const eyeToFloor = fy == null ? 1.62 : Math.max(0.6, camera.position.y - fy);
    const drop = eyeToFloor + feel.frame.place[1] - feel.surface.floorKiss;
    // The DRAWN pose never solves steeper than poseReachFloor allows — a jam
    // stalls the broom PROUD against the face instead of folding it to a
    // vertical stick at the feet. The sim contact keeps the true clamped
    // reach (cleaning is against the face anyway while jammed).
    const poseReach = Math.max(feel.collision.poseReachFloor, state.drawReach);
    const solvedPitch = -Math.atan2(drop, Math.max(0.25, poseReach));
    const blendSpan = Math.max(0.001, p.carryAbove - p.workBelow);
    const rawBlend = (p.carryAbove - clamped) / blendSpan;
    const workT = Math.max(0, Math.min(1, rawBlend));
    const workBlend = workT * workT * (3 - 2 * workT); // smoothstep
    // carry pose is camera-fixed (a carried tool tips with your look); the
    // work pose is world-fixed (camera-relative correction -pitch). A clamp
    // steepens the carry a LITTLE — the drawn head respects furniture, but
    // stalls rather than folds.
    const clampPull = 1 - (state.drawReach / Math.max(0.001, p.reachFar));
    const carryPitchEff = feel.frame.carryPitch - clampPull * feel.collision.carrySteepen;
    const groupPitch = carryPitchEff * (1 - workBlend)
      + (solvedPitch - pitch) * workBlend;
    // body sway: the rig trails the view's yaw and settles — weight you can
    // feel on every direction change, not just stroke reversals
    const yawNow = ctx.yaw ?? 0;
    if (state.lagYaw === undefined) state.lagYaw = yawNow;
    state.lagYaw += Math.atan2(Math.sin(yawNow - state.lagYaw), Math.cos(yawNow - state.lagYaw))
      * Math.min(1, dt * w.yawLagRate);
    const yawSway = reducedMotion ? 0 : Math.max(
      -w.yawLagMax, Math.min(w.yawLagMax,
        Math.atan2(Math.sin(state.lagYaw - yawNow), Math.cos(state.lagYaw - yawNow))),
    );
    broomGroup.position.set(
      feel.frame.place[0] + strokeX,
      feel.frame.place[1],
      feel.frame.place[2],
    );
    const rollLean = Math.max(-w.rollMax, Math.min(w.rollMax, state.lagV * w.rollVelGain));
    broomGroup.rotation.set(
      groupPitch,
      feel.frame.yaw + yawSway,
      (using ? rollLean : 0) + tilt * 0.5 * tiltAxis,
    );

    // --- camera response (sub-2°, eased both ways) --------------------------
    const k = feel.cameraKick;
    const kickTarget = inContact ? intensity : 0;
    const kickRate = kickTarget > kick ? dt / k.inTime : dt / k.outTime;
    kick += (kickTarget - kick) * Math.min(1, kickRate);

    // --- arms ---------------------------------------------------------------
    broomGroup.updateWorldMatrix(true, false);
    const handsRoot = fpHands.root;
    const rightHand = handsRoot.getObjectByName('FirstPersonRightHand');
    const leftHand = handsRoot.getObjectByName('FirstPersonLeftHand');
    state.armR = state.armR || {};
    state.armL = state.armL || {};
    if (rightHand) poseArm(right, rightHand, elbowOffsetRight, shoulderRight, state.armR);
    if (leftHand && leftHand.visible) poseArm(left, leftHand, elbowOffsetLeft, shoulderLeft, state.armL);
    left.group.visible = !!(leftHand && leftHand.visible);

    // --- head NDC (the level-pitch acceptance number) -----------------------
    // Measured on the DRAWN head — the rig-posed contact point — because the
    // acceptance is "you can SEE what you are sweeping", and in carry pose the
    // drawn head deliberately is not the sim contact.
    _headWorld.set(0, -0.215, -1.85); // the registry contact socket, tool-local
    broomGroup.localToWorld(_headWorld);
    // Project with THIS frame's camera pose: the render pass refreshes the
    // inverse after update, so relying on it here would read last frame's
    // matrices (and identity on the first).
    vmCamera.matrixWorld.copy(camera.matrixWorld);
    vmCamera.matrixWorldInverse.copy(vmCamera.matrixWorld).invert();
    _ndc.copy(_headWorld).project(vmCamera);
    lastHeadNdc = { x: +_ndc.x.toFixed(3), y: +_ndc.y.toFixed(3) };
    state.workBlend = workBlend;

    return {
      contactX: camera.position.x + fx * state.drawReach + rx * strokeX,
      contactZ: camera.position.z + fz * state.drawReach + rz * strokeX,
      clamped: clampedNow,
      inContact,
      // cleaning must not land while the broom is visibly CARRIED — the sim
      // contact only counts once the pose has blended onto the boards.
      planted: workBlend > 0.6,
      intensity,
      cameraKickRad: (kick * feel.cameraKick.maxDeg * Math.PI) / 180,
    };
  }

  function render() {
    if (!active) return;
    vmCamera.matrixWorld.copy(camera.matrixWorld);
    vmCamera.matrixWorldInverse.copy(vmCamera.matrixWorld).invert();
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(scene, vmCamera);
    renderer.autoClear = previousAutoClear;
  }

  function resize(aspect) {
    vmCamera.aspect = aspect;
    vmCamera.updateProjectionMatrix();
  }

  return {
    vmCamera,
    setActive,
    isActive: () => active,
    update,
    render,
    resize,
    easeInCubic,
    diagnostics: () => ({
      vmActive: active,
      fov: vmCamera.fov,
      layer: feel.camera.layer,
      reach: +reach.toFixed(3),
      drawReach: +(state.drawReach ?? reach).toFixed(3),
      workBlend: +(state.workBlend ?? 0).toFixed(3),
      clamped: clampedNow,
      tilt: +tilt.toFixed(3),
      intensity: +intensity.toFixed(3),
      headNdc: lastHeadNdc,
      arms: {
        right: armScreenMetrics(state.armR),
        left: armScreenMetrics(state.armL),
      },
    }),
    dispose() {
      for (const material of Object.values(mats)) material.dispose();
      for (const arm of [right, left]) {
        arm.group.traverse((object) => { if (object.isMesh) object.geometry.dispose(); });
        arm.group.removeFromParent();
      }
    },
  };
}

export default createBroomViewmodel;

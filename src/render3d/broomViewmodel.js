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

// One arm: an upper segment that exits the frame and a forearm that is
// re-aimed every frame to span elbow -> wrist, with the rolled cuff at the
// ELBOW end so its opening can never face the camera.
function buildArm(mats, mirror) {
  const group = new THREE.Group();
  group.name = mirror > 0 ? 'BroomRightArm' : 'BroomLeftArm';

  // Object3D.lookAt points a plain object's +Z at its target, so the forearm
  // is built along +Z: elbow at the pivot origin, wrist end toward +Z.
  const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.30, 6, 12), mats.skin);
  forearm.rotation.x = Math.PI / 2;
  const forearmPivot = new THREE.Group();
  forearmPivot.add(forearm);
  forearm.position.z = 0.17; // capsule centre sits between elbow and wrist
  group.add(forearmPivot);

  const sleeve = new THREE.Group();
  const sleeveBody = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.052, 0.11, 12), mats.cuff);
  sleeveBody.rotation.x = Math.PI / 2;
  sleeve.add(sleeveBody);
  const cuffRoll = new THREE.Mesh(new THREE.TorusGeometry(0.049, 0.013, 8, 18), mats.cuff);
  cuffRoll.position.z = 0.052; // the rolled opening faces the wrist, never the camera
  sleeve.add(cuffRoll);
  const cuffInner = new THREE.Mesh(new THREE.CircleGeometry(0.041, 18), mats.cuffDark);
  cuffInner.position.z = 0.056;
  sleeve.add(cuffInner);
  forearmPivot.add(sleeve);
  sleeve.position.z = 0.03; // wraps the elbow end of the forearm

  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.26, 6, 12), mats.cuff);
  upper.rotation.x = Math.PI / 2;
  const upperPivot = new THREE.Group();
  upperPivot.add(upper);
  upper.position.z = -0.15; // continues from the elbow away, off-frame
  group.add(upperPivot);

  for (const mesh of [forearm, sleeveBody, cuffRoll, cuffInner, upper]) {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  }
  return { group, forearmPivot, upperPivot };
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

  // Elbow anchors in CAMERA space: low, wide, behind the grips — off the
  // bottom corners of the viewmodel frame. They belong to the BODY, not the
  // tool, so they must not rotate with the shaft; each frame they are
  // converted into the broom group's local frame before posing.
  const elbowRightCam = new THREE.Vector3(0.42, -0.66, -0.16);
  const elbowLeftCam = new THREE.Vector3(-0.34, -0.70, -0.30);
  const _elbowWorld = new THREE.Vector3();

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

  // Aim one arm: pivot the forearm to look at the wrist from the elbow, and
  // the upper arm to run from the elbow away toward its off-frame shoulder.
  function poseArm(arm, handGroup, elbowCam) {
    handGroup.getWorldPosition(_wrist); // wrist, world
    // elbow: camera space -> world -> broom-local, so the anchor stays with
    // the body while the group carries the tool's pitch/roll
    _elbowWorld.copy(elbowCam).applyMatrix4(camera.matrixWorld);
    _elbow.copy(_elbowWorld);
    broomGroup.worldToLocal(_elbow);
    arm.group.position.copy(_elbow);
    _span.copy(_wrist).sub(_elbowWorld);
    const length = Math.max(0.12, _span.length());
    arm.forearmPivot.lookAt(_wrist);
    arm.forearmPivot.scale.z = length / 0.34; // authored span of the capsule
    // the upper arm continues the line away from the wrist, dropped toward
    // the frame's bottom edge
    arm.upperPivot.quaternion.copy(arm.forearmPivot.quaternion);
    arm.upperPivot.rotateX(-0.55);
  }

  function update(dt, ctx) {
    if (!active) return null;
    const {
      pitch = 0, using = false, moving = false, phase = 0, reducedMotion = false,
    } = ctx;

    // --- reach follows pitch (eased) ---------------------------------------
    const p = feel.pitch;
    const clamped = Math.max(p.minPitch, Math.min(p.maxPitch, pitch));
    const t = (clamped - p.minPitch) / (p.maxPitch - p.minPitch); // 0 steep .. 1 horizon
    let wantReach = p.reachNear + (p.reachFar - p.reachNear) * easeOutCubic(t);
    const follow = reducedMotion ? 1 : Math.min(1, dt * p.followRate);
    reach += (wantReach - reach) * follow;

    // --- stroke offset + collision clamp -----------------------------------
    const s = feel.stroke;
    const strokeX = using ? Math.sin(phase) * s.span : 0;
    const cosPhase = Math.cos(phase);
    const inContact = using && Math.abs(cosPhase) >= s.contactCos;
    const wantIntensity = using ? (inContact ? Math.abs(cosPhase) : 0.25) : 0;
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
    const solvedPitch = -Math.atan2(drop, Math.max(0.25, state.drawReach));
    const blendSpan = Math.max(0.001, p.carryAbove - p.workBelow);
    const rawBlend = (p.carryAbove - clamped) / blendSpan;
    const workT = Math.max(0, Math.min(1, rawBlend));
    const workBlend = workT * workT * (3 - 2 * workT); // smoothstep
    // carry pose is camera-fixed (a carried tool tips with your look); the
    // work pose is world-fixed (camera-relative correction -pitch). A clamp
    // steepens the carry too — the DRAWN head must respect furniture as much
    // as the working contact does.
    const clampPull = 1 - (state.drawReach / Math.max(0.001, p.reachFar));
    const carryPitchEff = feel.frame.carryPitch - clampPull * 0.55;
    const groupPitch = carryPitchEff * (1 - workBlend)
      + (solvedPitch - pitch) * workBlend;
    broomGroup.position.set(
      feel.frame.place[0] + strokeX,
      feel.frame.place[1],
      feel.frame.place[2],
    );
    broomGroup.rotation.set(
      groupPitch,
      feel.frame.yaw,
      (using ? cosPhase * feel.stroke.rollAmp : 0) + tilt * 0.5 * tiltAxis,
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
    if (rightHand) poseArm(right, rightHand, elbowRightCam);
    if (leftHand && leftHand.visible) poseArm(left, leftHand, elbowLeftCam);
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

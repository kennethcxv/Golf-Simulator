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
const _assetHead = new THREE.Vector3();
const _assetGrip = new THREE.Vector3();

// The tool's geometry in its own local frame. These are only the FALLBACK
// numbers from the registry's procedural broom; the authored GLB models the
// handle rising steeply (local y −0.27 → +0.85) rather than running flat along
// −Z, so solving against these while the GLB is what draws aimed the rig at
// points the mesh does not have. readRigGeometry() measures the live asset and
// these stand in only until it has loaded.
const FALLBACK_GEOM = {
  head: new THREE.Vector3(0, -0.215, -1.85),
  upper: new THREE.Vector3(0, 0.005, 0.08),
  lower: new THREE.Vector3(-0.015, 0, -0.48),
};
FALLBACK_GEOM.axis = FALLBACK_GEOM.head.clone().sub(FALLBACK_GEOM.upper).normalize();
FALLBACK_GEOM.len = FALLBACK_GEOM.head.distanceTo(FALLBACK_GEOM.upper);

const _gripCam = new THREE.Vector3();
const _headCam = new THREE.Vector3();
const _headWork = new THREE.Vector3();
const _headCarry = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _handPos = new THREE.Vector3();
const _axisX = new THREE.Vector3();
const _axisY = new THREE.Vector3();
const _axisZ = new THREE.Vector3();
const _qMin = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion();
const _qHandRoll = new THREE.Quaternion();
const _basis = new THREE.Matrix4();
const _sleeveAim = new THREE.Vector3();
const _palmOut = new THREE.Vector3();

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
  //
  // A TAPERED cylinder, not a capsule. Two reasons, both from the review:
  //  - a uniform tube is the "forearm cylinder" complaint; the wrist-to-elbow
  //    swell is the cue that makes it read as a limb rather than a pipe;
  //  - a capsule is span + 2r long overall, so its far cap protruded past the
  //    wrist and sat on the fingers. That cap was the "nub". A cylinder ends
  //    exactly where it is told to, and poseArm stops it short of the wrist so
  //    the hand covers the joint.
  // rotation.x = +PI/2 sends the cylinder's TOP (+Y) to +Z, which is the wrist
  // end, so radiusTop is the wrist and radiusBottom the elbow.
  const forearm = new THREE.Mesh(
    new THREE.CylinderGeometry(
      a.forearmWristRadius, a.forearmElbowRadius, a.forearmSpan, 14, 1, false,
    ), mats.skin,
  );
  forearm.rotation.x = Math.PI / 2;
  const forearmPivot = new THREE.Group();
  forearmPivot.add(forearm);
  forearm.position.z = a.forearmSpan / 2; // spans elbow (origin) -> wrist (+z)
  group.add(forearmPivot);

  // the rolled cuff wraps the elbow joint, aimed along the forearm; it is NOT
  // a child of the scaled pivot, so span adjustments never stretch the roll
  const cuff = new THREE.Group();
  // the roll and the sleeve mouth are sized off the ELBOW radius now that the
  // forearm tapers — sized off the wrist they stood proud of the arm they wrap
  const cuffRoll = new THREE.Mesh(
    new THREE.TorusGeometry(a.forearmElbowRadius + 0.012, 0.015, 8, 18), mats.cuff,
  );
  cuffRoll.position.z = 0.045;
  cuff.add(cuffRoll);
  const cuffBody = new THREE.Mesh(
    new THREE.CylinderGeometry(a.forearmElbowRadius + 0.008, a.sleeveRadius, 0.09, 12), mats.cuff,
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
  // the sleeve then runs a short authored distance straight down out of frame.
  const armCfg = feel.arms;
  const elbowOffsetRight = new THREE.Vector3(...armCfg.elbowOffsetRight);
  const elbowOffsetLeft = new THREE.Vector3(...armCfg.elbowOffsetLeft);
  const _elbowWorld = new THREE.Vector3();
  const _basisX = new THREE.Vector3();
  const _basisY = new THREE.Vector3();
  const _basisZ = new THREE.Vector3();

  // --- the rig's geometry, measured from whatever is actually drawn ---------
  // The authored GLB adopts some frames after equip and carries its own
  // sockets; until then the registry's procedural fallback is on screen. Both
  // are measured the same way, so the solve is correct for either and survives
  // an asset swap without a code change.
  //
  // These sockets are ANIMATED — the authored equip/work clips drive the
  // hierarchy they hang from, so their tool-local positions move every frame
  // (GripPrimary sat at y 0.12 mid-equip and y 0.79 once settled). Measuring
  // once and caching froze a transient equip pose and seated the hands 0.39 yd
  // off the handle, so only the node REFERENCES are cached; the positions are
  // re-read every frame.
  const socketRefs = { contact: null, primary: null, support: null, found: false };
  const _inv = new THREE.Matrix4();
  const liveGeom = {
    head: new THREE.Vector3(),
    upper: new THREE.Vector3(),
    lower: new THREE.Vector3(),
    axis: new THREE.Vector3(),
    len: 0,
  };
  function readRigGeometry() {
    if (!socketRefs.found) {
      socketRefs.contact = broomGroup.getObjectByName('SOCKET_FloorContact')
        || broomGroup.getObjectByName('SOCKET_contact');
      socketRefs.primary = broomGroup.getObjectByName('SOCKET_GripPrimary');
      socketRefs.support = broomGroup.getObjectByName('SOCKET_GripSupport');
      socketRefs.found = !!(socketRefs.contact && socketRefs.primary);
      if (!socketRefs.found) return null;
    }
    broomGroup.updateWorldMatrix(true, true);
    _inv.copy(broomGroup.matrixWorld).invert();
    socketRefs.contact.getWorldPosition(liveGeom.head).applyMatrix4(_inv);
    socketRefs.primary.getWorldPosition(liveGeom.upper).applyMatrix4(_inv);
    if (socketRefs.support) {
      socketRefs.support.getWorldPosition(liveGeom.lower).applyMatrix4(_inv);
    } else liveGeom.lower.copy(liveGeom.upper).lerp(liveGeom.head, 0.25);
    liveGeom.axis.copy(liveGeom.head).sub(liveGeom.upper);
    liveGeom.len = liveGeom.axis.length();
    if (!(liveGeom.len > 0.25)) return null; // a degenerate pose keeps the fallback
    liveGeom.axis.divideScalar(liveGeom.len);
    return liveGeom;
  }

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
    // the authored GLB may have adopted since the last equip — re-find sockets
    if (active) socketRefs.found = false;
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
  function poseArm(arm, handGroup, elbowOffset, sleeveMirror, stash) {
    handGroup.getWorldPosition(_wrist); // wrist, world
    camera.matrixWorld.extractBasis(_basisX, _basisY, _basisZ);
    // The offset is a DIRECTION; the elbow is placed exactly one forearm along
    // it. Authored as an absolute offset it drifted to 0.40 yd from the wrist
    // while the skin was clamped to forearmSpan * spanScaleMax = 0.312, so the
    // forearm could not reach its own hand and hung under it with a visible
    // gap — two tan cones floating below two hands, which is precisely the
    // "disembodied forearm" the review rejected. Deriving the elbow from the
    // authored length makes the skin span the joint by construction, at any
    // pose, and leaves spanScaleMin/Max to absorb only the wrist inset.
    _tmp.copy(_basisX).multiplyScalar(elbowOffset.x)
      .addScaledVector(_basisY, elbowOffset.y)
      .addScaledVector(_basisZ, elbowOffset.z);
    if (_tmp.lengthSq() < 1e-8) _tmp.copy(_basisY).multiplyScalar(-1);
    _tmp.normalize().multiplyScalar(armCfg.forearmSpan);
    _elbowWorld.copy(_wrist).add(_tmp);
    _elbow.copy(_elbowWorld);
    broomGroup.worldToLocal(_elbow);
    arm.group.position.copy(_elbow);
    _span.copy(_wrist).sub(_elbowWorld);
    const length = Math.max(0.12, _span.length());
    arm.forearmPivot.lookAt(_wrist);
    // Stop the skin SHORT of the wrist so the hand covers the joint. Running it
    // all the way to the wrist origin put a bare tube end among the fingers.
    const skinRun = Math.max(0.10, length - armCfg.wristInset);
    arm.forearmPivot.scale.z = Math.max(
      armCfg.spanScaleMin, Math.min(armCfg.spanScaleMax, skinRun / armCfg.forearmSpan),
    );
    arm.cuff.quaternion.copy(arm.forearmPivot.quaternion);
    // The sleeve runs a SHORT fixed distance from the elbow along an authored
    // camera-space direction (down and slightly back), so it leaves through the
    // bottom of the frame. It is never aimed at a point in front of the lens —
    // that is what drew the green bar across the frame in round 2.
    _sleeveAim.copy(_elbowWorld)
      .addScaledVector(_basisX, armCfg.sleeveDir[0] * sleeveMirror * armCfg.sleeveLength)
      .addScaledVector(_basisY, armCfg.sleeveDir[1] * armCfg.sleeveLength)
      .addScaledVector(_basisZ, armCfg.sleeveDir[2] * armCfg.sleeveLength);
    arm.sleevePivot.lookAt(_sleeveAim);
    arm.sleevePivot.scale.z = 1;
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
    // ROUND 3: the stroke is an ANGLE, not a sideways shove. The head swings on
    // an arc about the hands, so a pass reads as a sweep across the boards
    // instead of the whole rig twitching 0.16 yd left and right.
    const arcEff = feel.sweep.arcRad * (jammed ? feel.collision.stallSquash : 1);
    const strokeTarget = using ? Math.sin(phase) * arcEff : 0;
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

    // --- THE SHAFT IS RIGID -------------------------------------------------
    // A broom handle is a fixed length and the hands sit near its butt, so the
    // head cannot be placed at an arbitrary distance: it lies on a sphere of
    // radius `gripFromHead` about the gripping hand. Round 3's first attempt
    // authored the grip position, the head position AND the grip's place on the
    // shaft independently, which over-constrained it — the solve answered by
    // shoving the un-gripped butt end to within 7 cm of the lens, drawing a
    // pole clean across the frame. Now only the head's DIRECTION is authored
    // and its distance follows from the handle.
    const yaw = ctx.yaw ?? 0;
    const fx = -Math.sin(yaw); const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw); const rz = -Math.sin(yaw);
    const cc = feel.compose;
    const live = readRigGeometry();
    const geom = live || FALLBACK_GEOM;
    // WHICH GEOMETRY THE SOLVE USED. This is not decoration: FALLBACK_GEOM's
    // shaft axis is 126 deg away from the authored GLB's, so a silent fall back
    // to it while the GLB is what draws swings the real mesh a third of a turn
    // off the solved line — the handle rears up and the bristles end up over
    // your shoulder. Every other number in diagnostics() is computed in the
    // SAME frame as the mistake and therefore looks healthy while it happens,
    // which is exactly why this flag has to exist separately.
    state.geomSource = live ? 'live' : 'fallback';
    const gripLen = geom.len;
    const fy = floorY ? floorY(camera.position.x, camera.position.z) : null;

    // body sway: the rig trails the view's yaw and settles — weight you can
    // feel on every direction change, not just stroke reversals
    const yawNow = yaw;
    if (state.lagYaw === undefined) state.lagYaw = yawNow;
    state.lagYaw += Math.atan2(Math.sin(yawNow - state.lagYaw), Math.cos(yawNow - state.lagYaw))
      * Math.min(1, dt * w.yawLagRate);
    const yawSway = reducedMotion ? 0 : Math.max(
      -w.yawLagMax, Math.min(w.yawLagMax,
        Math.atan2(Math.sin(state.lagYaw - yawNow), Math.cos(state.lagYaw - yawNow))),
    );

    // --- bob, sway and breathe: the rig belongs to a BODY -------------------
    // These were authored in BROOM_FEEL from the start and never read, so the
    // module's own claim of "stride-locked bob, idle sway" was not true and
    // tuning any of those five numbers did nothing. Wired now.
    //
    // Under way the rig rises and falls at the characters' own stride rate, so
    // a walking player's tool moves in phase with their footfalls rather than
    // to its own unrelated rhythm; the lateral sway trails the bob by a set
    // fraction of a cycle, the way a carried weight lags the step that swings
    // it. At rest the bob fades out and a slow breathe and yaw drift take over,
    // because a perfectly still tool reads as mounted to the camera.
    const wk = feel.walk;
    const idl = feel.idle;
    state.bobAmp = state.bobAmp ?? 0;
    state.bobAmp += ((moving ? 1 : 0) - state.bobAmp) * Math.min(1, dt * wk.blendIn);
    state.bobPhase = (state.bobPhase ?? 0) + dt * wk.bobRate;
    state.idlePhase = (state.idlePhase ?? 0) + dt;
    const atRest = 1 - state.bobAmp;
    const bobY = reducedMotion ? 0 : Math.sin(state.bobPhase) * wk.bobAmp * state.bobAmp;
    const bobX = reducedMotion ? 0
      : Math.sin(state.bobPhase - wk.swayPhase * Math.PI * 2) * wk.swayAmp * state.bobAmp;
    const breatheY = reducedMotion ? 0
      : Math.sin(state.idlePhase * idl.breatheRate) * idl.breatheAmp * atRest;
    // the idle drift is a slow YAW of the rig about the grip, so the head
    // wanders a little rather than the whole tool sliding sideways
    const idleYaw = reducedMotion ? 0
      : Math.sin(state.idlePhase * idl.swayYawRate) * idl.swayYawAmp * atRest;

    // the gripping hand, in world space (it rides the camera)
    const handDrift = Math.sin(strokeX) * feel.sweep.handFollow;
    _gripCam.set(
      cc.gripAnchor[0] + handDrift + yawSway * 0.5 + bobX,
      cc.gripAnchor[1] + bobY + breatheY,
      cc.gripAnchor[2],
    ).applyMatrix4(camera.matrixWorld);

    // How far the head hangs BELOW the hand: a shallow carry at level look, the
    // real floor drop once the pose plants on the boards.
    const blendSpan = Math.max(0.001, p.carryAbove - p.workBelow);
    const workT = Math.max(0, Math.min(1, (p.carryAbove - clamped) / blendSpan));
    const workBlend = workT * workT * (3 - 2 * workT); // smoothstep
    const floorWorldY = fy == null ? camera.position.y - 1.62 : fy;
    const dropWork = _gripCam.y - (floorWorldY + feel.surface.floorKiss);
    const drop = cc.carryDrop * (1 - workBlend) + dropWork * workBlend;
    // the handle can only reach so far down; beyond that the head lifts
    const dropEff = Math.max(-gripLen * 0.9, Math.min(gripLen * 0.985, drop));
    let horiz = Math.sqrt(Math.max(0.0025, gripLen * gripLen - dropEff * dropEff));

    // The head's horizontal bearing: the view's forward, swung along the arc,
    // plus a standing offset that carries the head LEFT of the hands. Without
    // it the shaft points straight away from the lens and foreshortens to a
    // stub; the offset lays it diagonally across the lower frame instead.
    const bearing = strokeX + cc.bearingOffset + idleYaw;
    const sw = Math.sin(bearing); const cw = Math.cos(bearing);
    const hx = fx * cw + rx * sw;
    const hz = fz * cw + rz * sw;

    let nx = 0; let nz = 0;
    clampedNow = false;
    if (colliderQuery) {
      // Pull the head in until the swept half-width sits standoff clear of a
      // blocking face. With a rigid shaft, shortening the horizontal run RAISES
      // the head — the broom rides up the obstruction instead of passing through.
      const col = feel.collision;
      const probe = (r) => colliderQuery(
        _gripCam.x + hx * r, _gripCam.z + hz * r, col.headHalfWidth,
      );
      const hitAtFull = probe(horiz + col.probeAhead);
      if (hitAtFull?.blocked) {
        clampedNow = true;
        nx = hitAtFull.nx || -fx; nz = hitAtFull.nz || -fz;
        let lo = 0.12; let hi = horiz;
        for (let step = 0; step < 4; step += 1) {
          const midReach = (lo + hi) / 2;
          if (probe(midReach)?.blocked) hi = midReach;
          else lo = midReach;
        }
        horiz = Math.max(0.12, lo - col.standoff);
      }
    }
    const slide = Math.min(1, dt * feel.collision.slideRate);
    state.drawHoriz = state.drawHoriz === undefined ? horiz
      : state.drawHoriz + (horiz - state.drawHoriz) * slide;
    horiz = Math.min(state.drawHoriz, gripLen * 0.999);
    // rigid handle: whatever horizontal run survives, the drop follows from it
    const dropFinal = Math.sign(dropEff || 1)
      * Math.sqrt(Math.max(0, gripLen * gripLen - horiz * horiz));
    // THE CARRIED HEAD RIDES YOUR VIEW. Solving it as a world-space point left
    // it behind whenever you looked UP — the head fell off the bottom of the
    // frame (measured NDC y −1.08 at pitch +0.30). A carried tool is held in
    // your hands, so its carry pose is camera-relative; only the PLANTED pose
    // belongs to the world. The two are blended and then re-tensioned, so the
    // handle stays exactly one rigid length from the grip either way.
    const horizCarry = Math.sqrt(Math.max(0.0025,
      gripLen * gripLen - cc.carryDrop * cc.carryDrop));
    _headCarry.set(
      cc.gripAnchor[0] + handDrift + Math.sin(bearing) * horizCarry,
      cc.gripAnchor[1] - cc.carryDrop,
      cc.gripAnchor[2] - Math.cos(bearing) * horizCarry,
    ).applyMatrix4(camera.matrixWorld);

    _headWork.set(
      _gripCam.x + hx * horiz,
      _gripCam.y - dropFinal,
      _gripCam.z + hz * horiz,
    );
    // carry -> work, then re-tension onto the handle's exact length
    _headWork.lerp(_headCarry, 1 - workBlend);
    _tmp.copy(_headWork).sub(_gripCam);
    const span = _tmp.length();
    if (span > 1e-4) _headWork.copy(_gripCam).addScaledVector(_tmp, gripLen / span);
    // reach reported to the sim: horizontal distance from the player to the head
    state.drawReach = Math.hypot(
      _headWork.x - camera.position.x, _headWork.z - camera.position.z,
    );

    // --- surface tilt -------------------------------------------------------
    const wantTilt = clampedNow ? feel.surface.tiltMax : 0;
    tilt += (wantTilt - tilt) * Math.min(1, dt * feel.surface.tiltRate);
    tiltAxis = clampedNow ? (nx * rx + nz * rz >= 0 ? 1 : -1) : tiltAxis;

    // --- pose the rig --------------------------------------------------------
    // The grip and the head are both solved above, in world space and a rigid
    // handle apart. All that is left is to rotate the tool's own shaft axis
    // onto that line and slide it so the bristle socket lands on the head.
    const c = cc;
    _headCam.copy(_headWork);

    // Into the rig's own parent frame. That parent carries the held-rig
    // offsets (equip rise, recoil), so solving straight in local space
    // silently inherited them — measured 0.77 yd of unwanted forward push.
    const rigParent = broomGroup.parent;
    if (rigParent) {
      rigParent.updateWorldMatrix(true, false);
      rigParent.worldToLocal(_gripCam);
      rigParent.worldToLocal(_headCam);
    }

    // Solve: rotate the tool's own shaft axis onto the grip->head direction,
    // then position it so the bristle socket lands exactly on the head anchor.
    _dir.copy(_headCam).sub(_gripCam);
    const gripFromHead = _dir.length();
    if (gripFromHead < 1e-4) _dir.set(0, 0, -1);
    else _dir.divideScalar(gripFromHead);
    _qMin.setFromUnitVectors(geom.axis, _dir);
    const rollLean = Math.max(-w.rollMax, Math.min(w.rollMax, state.lagV * w.rollVelGain));
    _qRoll.setFromAxisAngle(_dir, (using ? rollLean : 0) + tilt * 0.5 * tiltAxis);
    broomGroup.quaternion.copy(_qRoll).multiply(_qMin);
    // position = head anchor minus the rotated tool-local head socket
    _tmp.copy(geom.head).applyQuaternion(broomGroup.quaternion);
    broomGroup.position.copy(_headCam).sub(_tmp);

    // --- both hands ON the shaft --------------------------------------------
    // The hands are placed on the solved shaft rather than read from the GLB's
    // own grip sockets, which sat off the shaft line and a yard and a half from
    // the lens (measured NDC y +0.52 for the primary hand — above eye level).
    // Upper hand at the solved grip distance, support hand further down toward
    // the head, both rolled so the fingers close around the handle.
    state.gripUpper = gripFromHead;
    state.gripLower = geom.head.distanceTo(geom.lower);

    // --- camera response (sub-2°, eased both ways) --------------------------
    const k = feel.cameraKick;
    const kickTarget = inContact ? intensity : 0;
    const kickRate = kickTarget > kick ? dt / k.inTime : dt / k.outTime;
    kick += (kickTarget - kick) * Math.min(1, kickRate);

    // --- hands ON the shaft, then the arms behind them -----------------------
    const handsRoot = fpHands.root;
    const rightHand = handsRoot.getObjectByName('FirstPersonRightHand');
    const leftHand = handsRoot.getObjectByName('FirstPersonLeftHand');
    // Seat each hand on the solved shaft: the fingers curl about the hand's own
    // local X, so that axis is laid along the handle and the pair are rolled to
    // opposite sides of it. handsRoot carries the equip rise and idle breathe,
    // so its offset comes back out of the tool-local target.
    const seat = (hand, socketLocal, roll) => {
      if (!hand) return;
      _handPos.copy(socketLocal);
      hand.position.copy(_handPos).sub(handsRoot.position);
      _axisX.copy(geom.axis);
      _axisZ.set(0, 1, 0).cross(_axisX);
      if (_axisZ.lengthSq() < 1e-6) _axisZ.set(1, 0, 0);
      _axisZ.normalize();
      _axisY.copy(_axisZ).cross(_axisX).normalize();
      _basis.makeBasis(_axisX, _axisY, _axisZ);
      hand.quaternion.setFromRotationMatrix(_basis);
      _qHandRoll.setFromAxisAngle(_axisX, roll);
      hand.quaternion.premultiply(_qHandRoll);
      // Rest the PALM on the handle instead of running the shaft through the
      // wrist. The fingers curl toward the hand's +Y (fpHands rotates each
      // finger root about +X), so the shaft belongs on that side and the wrist
      // sits one palm-thickness back along -Y.
      _palmOut.set(0, -1, 0).applyQuaternion(hand.quaternion)
        .multiplyScalar(c.handShaftOffset);
      hand.position.add(_palmOut);
    };
    seat(rightHand, geom.upper, c.handRollUpper);
    seat(leftHand, geom.lower, c.handRollLower);
    // how far the seated hand ended up from the socket it grips — the number
    // that caught the cached-socket bug (0.39 yd off) and must stay ~0
    state.seatError = rightHand ? _tmp.copy(rightHand.position)
      .add(handsRoot.position).distanceTo(geom.upper) : 0;

    broomGroup.updateWorldMatrix(true, false);
    state.armR = state.armR || {};
    state.armL = state.armL || {};
    if (rightHand) poseArm(right, rightHand, elbowOffsetRight, 1, state.armR);
    if (leftHand && leftHand.visible) poseArm(left, leftHand, elbowOffsetLeft, -1, state.armL);
    left.group.visible = !!(leftHand && leftHand.visible);

    // --- head NDC (the level-pitch acceptance number) -----------------------
    // Measured on the DRAWN head — the rig-posed contact point — because the
    // acceptance is "you can SEE what you are sweeping", and in carry pose the
    // drawn head deliberately is not the sim contact.
    _headWorld.copy(geom.head); // the live asset's contact socket, tool-local
    broomGroup.localToWorld(_headWorld);
    // Project with THIS frame's camera pose: the render pass refreshes the
    // inverse after update, so relying on it here would read last frame's
    // matrices (and identity on the first).
    vmCamera.matrixWorld.copy(camera.matrixWorld);
    vmCamera.matrixWorldInverse.copy(vmCamera.matrixWorld).invert();
    _ndc.copy(_headWorld).project(vmCamera);
    lastHeadNdc = { x: +_ndc.x.toFixed(3), y: +_ndc.y.toFixed(3) };
    state.workBlend = workBlend;

    // --- WHERE THE DRAWN MESH ACTUALLY POINTS -------------------------------
    // Read straight off the asset's own sockets in world space, AFTER the solve
    // has posed it. Everything above measures the rig in the frame the solve
    // believes in; if that belief is wrong the numbers agree with each other
    // and still describe a broom aimed at the ceiling. These two do not depend
    // on the solve's geometry at all, so they can contradict it.
    //
    // shaftDrop is the honest one: metres the bristle socket hangs BELOW the
    // gripping socket. A broom sweeps the floor, so it must be solidly
    // negative. Zero-ish is a broom held level; positive is a broom held up.
    if (socketRefs.found) {
      socketRefs.contact.getWorldPosition(_assetHead);
      socketRefs.primary.getWorldPosition(_assetGrip);
      state.shaftDrop = _assetHead.y - _assetGrip.y;
      _tmp.copy(_assetHead).sub(_assetGrip);
      const shaftLen = _tmp.length();
      state.shaftDropUnit = shaftLen > 1e-5 ? state.shaftDrop / shaftLen : 0;
      // THE ACCEPTANCE NUMBER for "the head rides the floor": yards the drawn
      // bristle socket sits above the boards under it. Near zero is contact;
      // a large positive is the head floating (the round-4 defect); negative
      // is the head sunk through the floor.
      const floorHere = floorY ? floorY(_assetHead.x, _assetHead.z) : null;
      state.headAboveFloor = floorHere == null ? null : _assetHead.y - floorHere;
      _ndc.copy(_assetHead).project(vmCamera);
      state.assetHeadNdc = { x: +_ndc.x.toFixed(3), y: +_ndc.y.toFixed(3) };
    } else {
      state.shaftDrop = null;
      state.shaftDropUnit = null;
      state.assetHeadNdc = null;
      state.headAboveFloor = null;
    }

    return {
      // the sim cleans exactly where the bristles are drawn
      contactX: _headWork.x,
      contactZ: _headWork.z,
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
      // which shaft axis the solve believed in, and where the DRAWN mesh
      // actually ended up pointing (see update() for why both are needed)
      geomSource: state.geomSource ?? null,
      shaftDrop: state.shaftDrop == null ? null : +state.shaftDrop.toFixed(3),
      shaftDropUnit: state.shaftDropUnit == null ? null : +state.shaftDropUnit.toFixed(3),
      headAboveFloor: state.headAboveFloor == null ? null : +state.headAboveFloor.toFixed(3),
      assetHeadNdc: state.assetHeadNdc ?? null,
      // where the two hands sit along the shaft (yd back from the bristles),
      // and the current swing of the sweep arc
      gripUpper: +(state.gripUpper ?? 0).toFixed(3),
      gripLower: +(state.gripLower ?? 0).toFixed(3),
      swingRad: +(state.lagX ?? 0).toFixed(3),
      seatError: +(state.seatError ?? 0).toFixed(4),
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

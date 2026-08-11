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
//      toward the feet), and the shaft pitch is SOLVED so the bristle line
//      kisses the floor at that reach — the contact point belongs to the
//      kinematic chain, so it no longer slides ~0.6 yd across the pitch range.
//      A8: "look up past liftAbove and it lifts with you" used to be here as a
//      feature. It was the float. The head's HEIGHT is floor-referenced in
//      both poses now and only its hover blends; looking up takes it out of
//      frame, which is what looking up at a ceiling does.
//      C2: anchoring the head was not enough on its own. Above +0.855 rad the
//      HANDS are higher than the handle can reach down from, so the head was
//      slung under them and rose anyway. The grip is capped at that reach
//      height on up-look; see the block around `reachLimit` in update().
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

// C2 — the last 0.10 yd of the up-look grip cap is eased, so the hands
// decelerate into it instead of stopping dead on the frame it is crossed. The
// ease starts this far BELOW the reach limit and asymptotes exactly ONTO it, so
// the cap is a true bound: no bob, breathe or sway amplitude can carry the
// hands past it and pop the head off the boards for a frame.
const GRIP_CEIL_SOFT = 0.10;
// How much further than REACH requires the grip keeps descending once the
// up-look cap has engaged, so the handle leaves the frame with the hand instead
// of hanging there on its own.
//
// I3 (2026-08-05), read off the live-pan flip-book rather than settled samples:
// with gain 3.0 the hand slipped under the frame at +0.80 (handY −1.05) while
// the stow had moved the rig only 0.045 yd — so the stub of handle above the
// now-invisible hand hung in frame for the +0.75..+0.90 band before the stow
// caught up. The stick must leave WITH its hand: the ~0.27 yd the stick top
// needs has to arrive within the first ~0.03 yd of cap, hence gain 10. The
// stow remains a continuous function of pitch (via the eased cap), engages
// nowhere below the cap's own threshold, and every pose at or below +0.75 rad
// is bit-identical by construction.
const GRIP_STOW_GAIN = 10.0;
const GRIP_STOW_MAX = 0.85;
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
const _camPos = new THREE.Vector3();
const _palmOut = new THREE.Vector3();
// I5: the drawn-world clamp ray (see the collision block)
const _meshRay = new THREE.Raycaster();
const _meshRayOrigin = new THREE.Vector3();
const _meshRayDir = new THREE.Vector3();

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
  cuff.name = mirror > 0 ? 'BroomRightCuff' : 'BroomLeftCuff';
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
  sleeve.name = mirror > 0 ? 'BroomRightSleeve' : 'BroomLeftSleeve';
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

// B4 — HOW MUCH RIGHT THE POSE HAS TO PUT THE HEAD ON THE FLOOR.
//
// The brief: "the rig plants the tool head on the floor regardless of whether
// the handle can physically reach. That is why the plant number read 0.073-0.084
// for every candidate in your sweep including one two yards below the eye."
//
// A head pinned to the boards while the hands sit somewhere no handle can span
// draws a shaft between two points that do not belong to the same object, which
// is very likely why the hand read as detached.
//
// So the plant is not a fact, it is an AUTHORITY: full while the hands are above
// the contact plane, fading to none across `ease` as they sink through it. Eased
// rather than switched, so there is no pop at the boundary.
//
// Pulled out of the frame solve and exported ON PURPOSE. Inside the solve it was
// three lines among five hundred, reachable only by booting Electron, equipping
// a broom and driving a grip-anchor override — which is why the rule shipped
// with no check at all. As a named function it is one import and a table of
// numbers, and `tests/broom-plant-authority.test.js` puts the brief's own
// counter-example in as a case.
//
// @param {number} gripWorldY   the gripping hand's world height
// @param {number} floorWorldY  the boards under the player
// @param {number} floorKiss    bristle compression into the boards
// @param {number} ease         metres of sink over which authority fades to 0
// @returns {number} 0..1
export function plantAuthorityFor(gripWorldY, floorWorldY, floorKiss, ease = 0.12) {
  const workDrop = gripWorldY - (floorWorldY + floorKiss);
  // Only sinking BELOW the plane costs authority. The too-high side needs no
  // gate here: a saturated drop already hangs the head a rigid handle's length
  // under the hands, so it cannot reach the floor by accident.
  const sinkYd = Math.max(0, -workDrop);
  const span = Math.max(1e-6, ease);
  return Math.max(0, Math.min(1, 1 - sinkYd / span));
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
  // I1 (2026-08-05): the rig was always "the broom's until approved, then
  // everyone's". `feel` parameterizes the whole tuning surface (a BROOM_FEEL-
  // shaped object from src/data/toolFeel.js), and `feel.anchor` selects the
  // pose family: 'floor' plants the head with the plant window, reach cap and
  // up-look stow; 'carry' keeps the carry hover at every pitch (a pressure
  // wand washes walls — capping its hands at floor reach would be nonsense).
  // One rig INSTANCE per tool, each bound to its own held group; only the
  // active one draws, so nine rigs cost what one did.
  feel = BROOM_FEEL,
  // I5: the DRAWN world for the clamp. The walk collider is authored for body
  // circles and sits well inside some fixtures' drawn slabs (measured 0.4-1.2
  // yd of overhang on the browse stands), so a collider-only clamp leaves the
  // head visibly buried. When provided, meshRoot() returns the interior group
  // and the clamp also honours the first drawn face along the reach ray.
  meshRoot = null,
  // A8: false leaves the shaft in ONE hand, with the support arm never built.
  // The registry is the authority (src/data/cleaningTools.js); this parameter
  // only carries its answer in. Defaults true so a caller that predates the
  // flag keeps the two-handed rig it was tuned for.
  twoHanded = true,
  // B4: a tool declared `hands: false` in the registry is drawn BARE. The rig
  // owns hand visibility while it is active, so it has to honour the flag
  // itself — the washer is a rig tool, and suppressing the shared fpHands root
  // would not touch arms the rig has reparented into its own group.
  showHands = true,
}) {
  const vmCamera = new THREE.PerspectiveCamera(
    feel.camera.fov, camera.aspect, feel.camera.near, feel.camera.far,
  );
  vmCamera.matrixAutoUpdate = false;
  vmCamera.layers.set(feel.camera.layer);

  // REUSE THE HANDS' MATERIALS INSTEAD OF BUILDING A SECOND SET.
  //
  // These three were constructed here from the same SKIN / CUFF / CUFF_DARK
  // constants and the same roughness values that `fpHands` already uses — the
  // same materials, twice, and once PER RIG because createBroomViewmodel runs
  // for every stick tool.
  //
  // Measured: the first tool equip compiled 9 programs for 9 distinct but
  // structurally identical MeshStandardMaterials (same type, shading, side, no
  // maps; differing only in colour and roughness, neither of which enters a
  // three.js program cache key). That cost 333 to 7855 ms on the first tool a
  // player takes out; the second equip compiled nothing and cost ~24 ms.
  //
  // Nine attempts to pre-compile those programs earlier all failed and were all
  // reverted. They had to: the nine existed because of DUPLICATION, not timing,
  // and no prewarm, camera, layer or attachment order can remove a material a
  // second module constructs independently.
  //
  // Appearance is unchanged — the colours were always the same constants. The
  // fallback keeps this module standalone if a caller passes no hands.
  const mats = (fpHands && fpHands.mats) || {
    skin: new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.72 }),
    cuff: new THREE.MeshStandardMaterial({ color: CUFF, roughness: 0.78 }),
    cuffDark: new THREE.MeshStandardMaterial({ color: CUFF_DARK, roughness: 0.85 }),
  };
  const right = buildArm(mats, 1);
  // Not built at all when the tool is single-handed: an invisible arm still
  // costs a traverse every frame and, more to the point, leaves something that
  // a later change can switch back on by accident.
  const left = twoHanded ? buildArm(mats, -1) : null;
  broomGroup.add(right.group);
  if (left) broomGroup.add(left.group);
  right.group.visible = false;
  if (left) left.group.visible = false;

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
  // I1: socket NAMES are per-asset vocabulary, not per-rig. The broom and mop
  // happen to use FloorContact/GripPrimary; the vacuum's contact is
  // SOCKET_DirtIntake, the dustpan's SOCKET_PanIntake with a single
  // SOCKET_Grip, the washer's SOCKET_SprayEmission — measured live when the
  // first generalized run read 'fallback' geometry for all three. The feel
  // carries each tool's names (toolFeel.js derives them from the registry's
  // own fp entry); the broom's names remain the default.
  const socketNames = feel.rig?.sockets || {};
  const CONTACT_NAMES = [socketNames.contact, 'SOCKET_FloorContact', 'SOCKET_contact'].filter(Boolean);
  const PRIMARY_NAMES = [socketNames.primary, 'SOCKET_GripPrimary'].filter(Boolean);
  const SUPPORT_NAMES = [socketNames.support, 'SOCKET_GripSupport'].filter(Boolean);
  function readRigGeometry() {
    if (!socketRefs.found) {
      const byName = (names) => {
        for (const name of names) {
          const hit = broomGroup.getObjectByName(name);
          if (hit) return hit;
        }
        return null;
      };
      socketRefs.contact = byName(CONTACT_NAMES);
      socketRefs.primary = byName(PRIMARY_NAMES);
      socketRefs.support = byName(SUPPORT_NAMES);
      socketRefs.found = !!(socketRefs.contact && socketRefs.primary);
      if (!socketRefs.found) return null;
      // the sockets are resolved, so the head's visual parts can be gathered
      // onto a pivot that swings without moving the contact point
      buildHeadLag();
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
  // B3/B4 sweep hook; see the note at its use site in the frame solve.
  let gripAnchorOverride = null;

  // Q7 (2026-08-06): "make sure the actual bristles for the mop and broom etc
  // move with accurate physics."
  //
  // The head is a mass on the end of a stick: it TRAILS the stroke and flicks
  // when the stroke reverses. That is one spring, driven by the head socket's
  // own lateral speed, and it is what makes a sweep read as weight rather
  // than a rigid prop sliding about.
  //
  // It is applied to a pivot holding the head's VISUAL meshes only - the
  // contact socket itself never moves, so "the sim cleans exactly where the
  // bristles are drawn" stays true and a lagging head cannot walk the
  // cleaning point off the stroke.
  const headLag = {
    pivot: null,      // the inserted visual pivot, or null if there is nothing to swing
    built: false,
    angle: 0,         // radians, current
    vel: 0,           // radians/s
    lastPos: new THREE.Vector3(),
    hasLast: false,
    reason: 'not built',
  };
  const HEAD_LAG = {
    // a broom head is light and springy; heavier mop yarn is handled by its
    // own feel entry overriding these
    stiffness: feel.headLag?.stiffness ?? 128,
    damping: feel.headLag?.damping ?? 15,
    drive: feel.headLag?.drive ?? 0.9,
    maxAngle: feel.headLag?.maxAngle ?? 0.30,
  };

  // B0 (2026-08-07): THE PIVOT USED TO GRAB THE WHOLE TOOL, AND THE HAND
  // STAYED BEHIND. "The socket's siblings" was written for a GLB whose head
  // meshes were separate nodes beside the socket; the rebuilt assets parent
  // EVERYTHING to one LOD0 node, so the sweep wrapped all 13 broom meshes —
  // handle and grip wrap included — and every fast head motion (a real
  // camera turn, above all) swung the entire drawn broom about the contact
  // point while the sockets, and the hand seated on them, stayed put.
  // Measured: hand-to-socket 0.035 yd all night while the drawn hand-to-
  // grip-wrap pixel gap hit 302 px mid-turn. The mop had the MIRROR bug:
  // its pivot was built while the procedural fallback meshes were the
  // siblings, adoptAuthored() then removed them, and `built` stayed
  // latched — an EMPTY pivot, no head life at all.
  //
  // So: selection is bounded — a mesh joins the head pivot only if it is
  // head-NAMED, or its world centre sits within headRadius of the contact
  // socket AND it is not shaft-named. And the pivot REBUILDS whenever the
  // contact socket node changes (fallback -> authored adoption, re-equip),
  // instead of latching on the first build forever.
  const HEAD_NAME = /bristle|block|skirt|collar|head|pan(?!el)|intake|nozzle/i;
  const SHAFT_NAME = /handle|gripwrap|gripband|buttcap|hanghole|ferrule|shaft|pole/i;
  const HEAD_RADIUS_YD = 0.5;
  const _headSel = new THREE.Vector3();
  const _sockSel = new THREE.Vector3();

  function teardownHeadLag() {
    const pivot = headLag.pivot;
    if (!pivot || !pivot.parent) { headLag.pivot = null; return; }
    const parent = pivot.parent;
    // un-swing before handing children back, or a mid-swing teardown bakes
    // the current lag angle into every child's rest offset
    pivot.rotation.set(0, 0, 0);
    pivot.updateMatrixWorld(true);
    for (const child of [...pivot.children]) {
      child.position.add(pivot.position);
      parent.add(child);
    }
    parent.remove(pivot);
    headLag.pivot = null;
    headLag.angle = 0;
    headLag.vel = 0;
    headLag.hasLast = false;
  }

  function buildHeadLag() {
    const socket = socketRefs.contact;
    // rebuild when a strand/bristle rig attached AFTER the pivot was built —
    // it must ride the head swing, not sit beside it as a sibling
    const strayRig = socket?.parent?.children?.some(
      (child) => /StrandRig/i.test(child.name || ''),
    );
    if (headLag.built && headLag.socketNode === socket && headLag.pivot
      && headLag.pivot.children.length && !strayRig) return;
    teardownHeadLag();
    headLag.built = true;
    headLag.socketNode = socket || null;
    const parent = socket?.parent;
    if (!socket || !parent) { headLag.reason = 'no contact socket'; return; }
    socket.getWorldPosition(_sockSel);
    const near = parent.children.filter((child) => {
      if (child === socket || child.type === 'Bone') return false;
      if (!child.getObjectByProperty || !hasMeshUnder(child)) return false;
      const name = child.name || '';
      if (SHAFT_NAME.test(name)) return false;
      if (HEAD_NAME.test(name)) return true;
      child.getWorldPosition(_headSel);
      return _headSel.distanceTo(_sockSel) <= HEAD_RADIUS_YD;
    });
    if (!near.length) { headLag.reason = 'no head meshes to swing'; return; }
    const pivot = new THREE.Group();
    pivot.name = 'ToolHeadLagPivot';
    pivot.position.copy(socket.position);
    parent.add(pivot);
    for (const child of near) {
      child.position.sub(socket.position);
      pivot.add(child);
    }
    headLag.pivot = pivot;
    headLag.reason = `swinging ${near.length} head part(s) of ${parent.children.length - 1} siblings`;
  }

  function hasMeshUnder(object) {
    let found = false;
    object.traverse((o) => { if (o.isMesh) found = true; });
    return found;
  }

  const _camInvLag = new THREE.Matrix4();
  const _headCamLocal = new THREE.Vector3();
  function updateHeadLag(dt, headWorld) {
    if (!headLag.pivot || !(dt > 0)) return;
    // B0: the head's lateral speed, measured in the CAMERA frame. The old
    // world-frame difference read a camera TURN as a huge lateral sweep —
    // yaw-rate x reach — and slammed the lag to its clamp exactly when the
    // player looks around. In camera space a turn barely moves the held
    // head (it rides the view); a STROKE moves it plenty. Strokes swing,
    // turns do not, which is what a head on a stick does.
    _camInvLag.copy(camera.matrixWorld).invert();
    _headCamLocal.copy(headWorld).applyMatrix4(_camInvLag);
    if (!headLag.hasLast) {
      headLag.lastPos.copy(_headCamLocal);
      headLag.hasLast = true;
      return;
    }
    _tmp.copy(_headCamLocal).sub(headLag.lastPos);
    headLag.lastPos.copy(_headCamLocal);
    // strip the vertical: a head bobbing up and down should not fan sideways
    _tmp.y = 0;
    const lateral = _tmp.x / dt;
    // spring toward zero, driven by how fast the head is being dragged
    const target = Math.max(-HEAD_LAG.maxAngle, Math.min(
      HEAD_LAG.maxAngle, -lateral * HEAD_LAG.drive * 0.06,
    ));
    const accel = (target - headLag.angle) * HEAD_LAG.stiffness
      - headLag.vel * HEAD_LAG.damping;
    headLag.vel += accel * dt;
    headLag.angle += headLag.vel * dt;
    headLag.angle = Math.max(-HEAD_LAG.maxAngle * 1.4,
      Math.min(HEAD_LAG.maxAngle * 1.4, headLag.angle));
    // swing about the shaft's own axis so the bristle line fans, which is the
    // motion a real head makes
    headLag.pivot.rotation.z = headLag.angle;
  }

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
    right.group.visible = active && showHands;
    if (left) left.group.visible = active && showHands;
    // The full arms replace the stub forearm + cuff for the duration.
    fpHands.setArmStubsVisible?.(!active);
    // …and the hands read at the broom's own size while it owns them, then go
    // back to the shared default for every other tool.
    fpHands.setHandScale?.(active ? (feel.compose.handScale || 1) : 1);
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
    // …AT A CONSTANT SCREEN LENGTH, NOT A CONSTANT WORLD LENGTH.
    //
    // Reported as "one arm showing a green sleeve while the other exits as bare
    // skin", and it is not the arm code being asymmetric — both arms run this
    // same solve with mirrored offsets. The two hands grip the shaft at
    // different HEIGHTS, so their wrists sit at different distances from the
    // lens, and a fixed 0.26 yd forearm projects to two different on-screen
    // lengths. The nearer arm's elbow — which is where the cuff and the sleeve
    // live — lands outside the frame while the further arm's stays inside it.
    // One sleeved, one bare, from one number.
    //
    // Scaling the forearm by the wrist's own depth makes the PROJECTED length
    // equal for both, so the cuff sits the same distance down each arm on
    // screen. Clamped so a hand that swings very close or very far cannot make
    // an arm absurd.
    const wristDepth = Math.max(0.20, _wrist.distanceTo(camera.getWorldPosition(_camPos)));
    const depthScale = Math.min(1.6, Math.max(0.7, wristDepth / armCfg.forearmDepthRef));
    _tmp.normalize().multiplyScalar(armCfg.forearmSpan * depthScale);
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
    // D2: THE CLAMP BOUNDS THE AUTHORED SPAN'S STRETCH, NOT THE DEPTH SCALING.
    //
    // Round 6 introduced depthScale (0.7..1.6) so both forearms project to the
    // same screen length, and placed the elbow a depth-scaled span from the
    // wrist. But the skin scale kept dividing by the RAW forearmSpan, so it
    // asked for up to 1.56 against a spanScaleMax of 1.2 — and the clamp won.
    // Measured: the left forearm drew 0.312 yd across a 0.416 yd elbow-to-wrist
    // run, so it stopped 0.094 yd short of its own hand and showed its flat cap
    // hanging in mid-air. Every existing arm number reported this as healthy,
    // because both ENDPOINTS were right and only the mesh between them was
    // short.
    //
    // Normalising by the same depthScale the elbow was placed with puts the
    // ratio back at ~0.97 at every depth, so the clamp is once again the safety
    // net the round-5 comment above describes rather than the binding
    // constraint. The elbow — and with it the cuff and sleeve that round 6
    // fixed — does not move.
    const spanScale = skinRun / (armCfg.forearmSpan * depthScale);
    arm.forearmPivot.scale.z = depthScale * Math.max(
      armCfg.spanScaleMin, Math.min(armCfg.spanScaleMax, spanScale),
    );
    // D2 INSTRUMENT: does the drawn skin actually REACH the hand it is aimed at?
    // Everything above reasons about `length`; what the player sees is
    // scale.z * forearmSpan. If the clamp bites, those differ and the arm ends
    // in mid-air showing its flat cap — which no NDC or span number can detect,
    // because both endpoints are still perfectly correct.
    if (stash) stash.drawnYd = arm.forearmPivot.scale.z * armCfg.forearmSpan;
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
      // yards of elbow->wrist run the skin FAILS to cover. Positive = the
      // forearm stops short of its own hand and shows its cap in mid-air.
      drawnYd: stash.drawnYd === undefined ? null : +stash.drawnYd.toFixed(3),
      reachGapYd: stash.drawnYd === undefined ? null
        : +(stash.spanYd - armCfg.wristInset - stash.drawnYd).toFixed(3),
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
    // ITEM 8: a tool that hangs strands off its head gets them driven from the
    // rig's own stroke, so the yarn trails the SAME swing the head is on rather
    // than a second rhythm of its own.
    // B3: and from the head's CARRY fan as well, not only the mopping stroke.
    // strokeTarget is zero whenever `using` is false, so a mop that was merely
    // being walked across a room drove its yarn with nothing at all; the head
    // fanned, the collar inherited the fan, and the strands rode it welded.
    // headLag.angle is that fan, and it is the signal the yarn should trail.
    const strandRig = broomGroup?.userData?.strandRig;
    if (strandRig?.isVerlet) {
      // B2 (Goal 20): a world-space solver needs NO drive signal. It reads the
      // anchor's own world matrix, so the stroke, the carry fan and the head's
      // world delta — three separate inputs the filtered rig below had to be
      // told about one at a time — are all simply where the head is. What it
      // does need is the boards, for the floor contact that makes the yarn
      // spread. floorWorldY is computed further down this same function; one
      // frame of latency on a floor height is invisible and costs no raycast.
      strandRig.update(dt, state._floorWorldY ?? null);
    } else if (strandRig) {
      // E4 (Goal 19): the carry drive listens to the WHOLE head's world
      // motion, not only the swing fan. A yaw turn slides the head across
      // the room without fanning it, and the yarn hung dead through every
      // turn (measured 0.8x idle on the instanced sampler). The head's world
      // delta, expressed in the rig's own frame and signed along the fan
      // axis, joins the fan angle — so walking, strafing and turning all
      // stir the strands the way carrying a real mop does.
      const ud = broomGroup.userData;
      if (!ud._carryPrev) {
        ud._carryPrev = new THREE.Vector3();
        ud._carryDelta = new THREE.Vector3();
        ud._carryQuat = new THREE.Quaternion();
        ud._carryInit = false;
      }
      broomGroup.getWorldPosition(ud._carryDelta); // reuse as "now" first
      let carryDrive = headLag.angle || 0;
      if (ud._carryInit && dt > 0) {
        const nowX = ud._carryDelta.x;
        const nowY = ud._carryDelta.y;
        const nowZ = ud._carryDelta.z;
        ud._carryDelta.sub(ud._carryPrev);
        ud._carryDelta.applyQuaternion(broomGroup.getWorldQuaternion(ud._carryQuat).invert());
        const lateral = (ud._carryDelta.x + ud._carryDelta.z * 0.4) / dt;
        carryDrive += Math.max(-0.6, Math.min(0.6, lateral * 0.22));
        ud._carryPrev.set(nowX, nowY, nowZ);
      } else {
        ud._carryPrev.copy(ud._carryDelta);
        ud._carryInit = true;
      }
      strandRig.update(dt, strokeX, state.lagV || 0, state.workBlend ?? 0, carryDrive);
    }
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
    // B3/B4: a live gripAnchor override, for the framing sweep. The shipped
    // value in feel.compose stays authoritative; this is null unless a QA
    // driver has set one, so nothing in the game reads a number the file does
    // not say.
    const cc = gripAnchorOverride
      ? { ...feel.compose, gripAnchor: gripAnchorOverride }
      : feel.compose;
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

    // The gripping hand, in world space (it rides the camera).
    //
    // ITEM 7: the hands swing on their OWN ARC. handFollow is the radius they
    // turn on about a body pivot behind them, so the sideways travel is
    // sin(stroke) * R and the depth term is the arc's own sagitta — the hands
    // come a little closer to the lens at the extremes, the way your shoulders
    // carry your hands round rather than along a rail. A pure lateral slide is
    // what made the hand read as dragged rather than driving.
    const handRadius = feel.sweep.handFollow;
    const handDrift = Math.sin(strokeX) * handRadius;
    const handPull = (1 - Math.cos(strokeX)) * handRadius;
    _gripCam.set(
      cc.gripAnchor[0] + handDrift + yawSway * 0.5 + bobX,
      cc.gripAnchor[1] + bobY + breatheY,
      cc.gripAnchor[2] + handPull,
    ).applyMatrix4(camera.matrixWorld);

    // How far the head hangs BELOW the hand: a shallow carry at level look, the
    // real floor drop once the pose plants on the boards.
    const blendSpan = Math.max(0.001, p.carryAbove - p.workBelow);
    const workT = Math.max(0, Math.min(1, (p.carryAbove - clamped) / blendSpan));
    // 'carry' rigs (the pressure wand) never plant: the hover stays at carry
    // height across the whole pitch range and the floor terms below go inert.
    const workBlend = feel.anchor === 'carry' ? 0 : workT * workT * (3 - 2 * workT); // smoothstep
    const floorWorldY = fy == null ? camera.position.y - 1.62 : fy;
    state._floorWorldY = floorWorldY; // the yarn solver reads this next frame
    // A8: BOTH POSES ARE FLOOR-REFERENCED. What blends is the HOVER HEIGHT.
    //
    // This used to blend a floor-referenced work drop against a constant carry
    // drop below hands that ride camera.matrixWorld — two different reference
    // frames — so above carryAbove the head had no floor reference at all and
    // simply rose with the view. Measured: bristles 0.601 yd above the boards at
    // level and 1.206 yd at maxPitch, a 0.605 yd lift bought purely by looking
    // up. carryHover is set to reproduce the level-look pose exactly, so round
    // 5's carried shaft angle is preserved and only the pitch response changes.
    // B4 (2026-08-07): THE PLANT IS ONLY LEGAL WHEN THE HANDLE CAN SPAN IT.
    // The framing sweep's own note — "the contact socket held 0.073-0.084 yd
    // above the floor for EVERY candidate, including one 2 yd below the eye"
    // — was the rig planting from BELOW: hands under the contact plane got a
    // head snapped UP onto the boards, drawing a shaft between two points no
    // handle connects. Authority over the work pose now fades as the hands
    // sink through the plant height (12 cm ease, no pop at the boundary);
    // the too-high side needs no gate — a saturated dropEff already hangs
    // the head a rigid handle below the hands.
    // The rule itself now lives at module scope as `plantAuthorityFor`, so it
    // can be read and tested without booting a renderer. Behaviour unchanged.
    const plantAuthority = plantAuthorityFor(_gripCam.y, floorWorldY, feel.surface.floorKiss);
    const workBlendEff = workBlend * plantAuthority;
    const hover = cc.carryHover * (1 - workBlendEff) + feel.surface.floorKiss * workBlendEff;

    // C2: THE HANDS ARE WHAT RISE, AND A RIGID HANDLE HAS TO FOLLOW THEM.
    //
    // A8 anchored the head's HEIGHT to the floor and measured 0.002 yd of lift
    // — across a sweep that stopped at +0.30 rad, on the belief that
    // broomFeel's maxPitch was the look limit. mouseLook.js clamps at ±1.35.
    // Re-measured over the real range (tools/qa/broom-lookup-clip.js): the
    // anchor holds to +0.855 rad and then breaks, and the head climbs 0.38 yd
    // between there and full up-look.
    //
    // Nothing about the anchor is wrong. gripAnchor is applied through
    // camera.matrixWorld, so craning your neck to 77° hoists your hands 1.07 yd
    // — and at 3.164 yd of hand height a 1.36 yd handle simply cannot reach the
    // boards any more. Past that point the head is rigidly slung under hands
    // that ride the camera, so it tracks them 1:1. That is the "rises and hangs
    // there" the playtest saw, and no amount of anchoring the head can fix it
    // while the hands keep climbing.
    //
    // So cap the HANDS instead, at exactly the height from which the handle can
    // still put the bristles on the floor. Derived, not tuned: it moves with
    // gripLen and carryHover on its own. Looking up now stops lifting your
    // hands once the broom is hanging straight down — which is what happens if
    // you hold a broom and look at the ceiling — and the head does not move.
    //
    // Engaged ONLY above level, so every pose at or below the horizon (the
    // whole working range) is bit-identical to before.
    // The uncapped anchor, kept so the cap's own magnitude is measurable rather
    // than inferred. "Do the hands detach at extreme up-look" is a question
    // about THIS number: it is exactly how far below the camera's own hoist the
    // hands are being held, and nothing else in the diagnostics reports it.
    const gripUncappedY = _gripCam.y;
    if (pitch > 0 && feel.anchor !== 'carry') {
      // the highest the hands can be and still reach: dropEff saturates at
      // gripLen * 0.985, so anything above this is hand height the handle
      // cannot spend, and the head pays for it
      const reachLimit = floorWorldY + hover + gripLen * 0.985;
      const easeFrom = reachLimit - GRIP_CEIL_SOFT;
      if (_gripCam.y > easeFrom) {
        const over = _gripCam.y - easeFrom;
        _gripCam.y = easeFrom + GRIP_CEIL_SOFT * (1 - Math.exp(-over / GRIP_CEIL_SOFT));
      }
    }
    const capYd = gripUncappedY - _gripCam.y;
    // C2, ROUND 2: THE CAP ON ITS OWN LEAVES A STICK WITH NO HAND ON IT.
    //
    // Measured after the fix (tools/qa/broom-c2-reverify.js, flip-book at
    // qa/electron/broom-c2/): the head number is perfect — 0.600 yd above the
    // boards at every pitch from 0 to the real +1.35 limit, zero lift. But the
    // hands sit at NDC y -0.95 at level, one twentieth of the frame off the
    // bottom edge, so the moment the cap starts pulling them down they leave the
    // frame — while the handle ABOVE them, being long, does not. At +1.00 rad
    // the screen shows a brown stick floating in front of the ceiling with
    // nothing holding it. That is its own bug, and it is one the cap created.
    //
    // The cap descends only as far as REACH requires. Keep descending past that
    // and the handle follows the hand out of frame together, which is what a
    // tool you cannot currently use should do — every first-person game lowers
    // the weapon rather than freezing it. Ramped off the cap's own magnitude so
    // it cannot engage anywhere the cap does not, which keeps every pose at or
    // below +0.746 rad bit-identical.
    const stowYd = capYd > 0 ? Math.min(GRIP_STOW_MAX, capYd * GRIP_STOW_GAIN) : 0;
    _gripCam.y -= stowYd;
    state.gripCapYd = capYd;
    state.gripStowYd = stowYd;
    state.gripCamWorldY = _gripCam.y;

    const drop = _gripCam.y - (floorWorldY + hover);
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
      // I5: the probe walks the PATH, not just the endpoint. Endpoint-only
      // sampling let a long tool thread a thin fixture: the broom probed at
      // horiz+ahead ≈ 2.1 yd — beyond the far side of a 0.5 yd shelf standing
      // 0.6 yd out — read "free", and drew its shaft straight through the
      // slab (measured 1.67 yd of mesh penetration while clamped=false). Any
      // blocked sample along the run counts as the hit.
      let hitAtFull = null;
      const probeSpan = horiz + col.probeAhead;
      for (let r = Math.min(0.35, probeSpan); r <= probeSpan + 1e-6; r += 0.30) {
        const sample = probe(Math.min(r, probeSpan));
        if (sample?.blocked) { hitAtFull = sample; break; }
      }
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
      // (I5 note, measured and then REMOVED: a mesh-ray "final say" was tried
      // here twice — horizontal at grip height, then along the shaft line —
      // and both made the numbers WORSE, because one ray through a cluttered
      // volume clamps or misses by face luck. The path-walked collider probe
      // above is the honest clamp; where a prop's collider is deliberately
      // loose — the walk-into-able junk piles — a single ray cannot certify
      // the volume and a capsule test is the real remaining work. meshRoot
      // stays available for that day.)
    }
    const slide = Math.min(1, dt * feel.collision.slideRate);
    state.drawHoriz = state.drawHoriz === undefined ? horiz
      : state.drawHoriz + (horiz - state.drawHoriz) * slide;
    horiz = Math.min(state.drawHoriz, gripLen * 0.999);
    // rigid handle: whatever horizontal run survives, the drop follows from it
    const dropFinal = Math.sign(dropEff || 1)
      * Math.sqrt(Math.max(0, gripLen * gripLen - horiz * horiz));
    // A8 REVERSES A ROUND-5 CALL, DELIBERATELY.
    //
    // There used to be a second, camera-relative _headCarry solved here and
    // lerped against the planted one. It existed because solving the carry in
    // world space "left the head behind whenever you looked UP — the head fell
    // off the bottom of the frame (measured NDC y −1.08 at pitch +0.30)".
    //
    // That was treated as the defect. It is the correct behaviour: look at the
    // ceiling holding a broom and you do not see the bristles, you see your
    // hands and the shaft — and those ride the camera here regardless, so the
    // frame is never empty. courseScene's own floor-anchor contract says the
    // same thing ("look at the horizon and the head correctly swings below the
    // frame"). Keeping it framed cost a head hanging 1.2 yd off the boards,
    // which is what the playtest saw and called floating.
    //
    // One floor-referenced solve now, blended by hover height above, so there
    // is nothing left to cross reference frames.
    _headWork.set(
      _gripCam.x + hx * horiz,
      _gripCam.y - dropFinal,
      _gripCam.z + hz * horiz,
    );
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
    // ITEM 7: the wrist carries part of the stroke. rollLean alone is a
    // VELOCITY lean — it peaks mid-stroke and passes through zero at both
    // ends, so the hand's orientation at the two extremes of a sweep was
    // identical and the grip read as a clamp sliding along a rail. Adding a
    // term on the stroke ANGLE means the wrist is turned one way at the end of
    // the push and the other way at the end of the pull, which is the cue that
    // says the hand is driving the head rather than being towed by it.
    const rollLean = Math.max(-w.rollMax, Math.min(w.rollMax, state.lagV * w.rollVelGain));
    const rollStroke = strokeX * (feel.sweep.handRoll ?? 0);
    _qRoll.setFromAxisAngle(_dir, (using ? rollLean + rollStroke : 0) + tilt * 0.5 * tiltAxis);
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
    if (twoHanded) seat(leftHand, geom.lower, c.handRollLower);
    else if (leftHand) leftHand.visible = false;
    // how far the seated hand ended up from the socket it grips — the number
    // that caught the cached-socket bug (0.39 yd off) and must stay ~0
    state.seatError = rightHand ? _tmp.copy(rightHand.position)
      .add(handsRoot.position).distanceTo(geom.upper) : 0;

    broomGroup.updateWorldMatrix(true, false);
    state.armR = state.armR || {};
    state.armL = state.armL || {};
    if (rightHand) poseArm(right, rightHand, elbowOffsetRight, 1, state.armR);
    if (left && leftHand && leftHand.visible) poseArm(left, leftHand, elbowOffsetLeft, -1, state.armL);
    if (left) left.group.visible = showHands && !!(leftHand && leftHand.visible);

    // --- head NDC (the level-pitch acceptance number) -----------------------
    // Measured on the DRAWN head — the rig-posed contact point — because the
    // acceptance is "you can SEE what you are sweeping", and in carry pose the
    // drawn head deliberately is not the sim contact.
    _headWorld.copy(geom.head); // the live asset's contact socket, tool-local
    broomGroup.localToWorld(_headWorld);
    // the head trails the stroke, driven by where the contact point has just
    // been. Run AFTER the shaft is solved, so the input is the real motion.
    updateHeadLag(dt, _headWorld);
    // Project with THIS frame's camera pose: the render pass refreshes the
    // inverse after update, so relying on it here would read last frame's
    // matrices (and identity on the first).
    vmCamera.matrixWorld.copy(camera.matrixWorld);
    vmCamera.matrixWorldInverse.copy(vmCamera.matrixWorld).invert();
    _ndc.copy(_headWorld).project(vmCamera);
    lastHeadNdc = { x: +_ndc.x.toFixed(3), y: +_ndc.y.toFixed(3) };
    // B4: downstream consumers (strand contact, dirt gating, diagnostics)
    // see the EFFECTIVE blend — pitch-wants-work x handle-can-reach
    state.workBlend = workBlendEff;
    state.plantAuthority = plantAuthority;
    // Where the plane the authority is measured against actually is.
    state.floorWorldY = floorWorldY;
    // Q7: the head's trail, so a driver can measure that it actually swings
    // and settles rather than taking "it has physics" on trust
    state.headLag = {
      swinging: !!headLag.pivot,
      reason: headLag.reason,
      angle: +headLag.angle.toFixed(4),
      vel: +headLag.vel.toFixed(3),
    };

    // D2: WHERE EACH HAND LANDS IN THE FRAME.
    //
    // Every hand review so far has been done on a full 1280x720 frame, in which
    // a hand is about 90 px across and its knuckles are two pixels each. That is
    // how "reads as an ovoid with a thumb" survived four rounds of hand work —
    // at that size an articulated hand and a lump are the same picture. These
    // let a driver crop to the hand instead of eyeballing the whole frame.
    for (const [key, hand] of [['handNdcUpper', rightHand], ['handNdcLower', leftHand]]) {
      if (!hand || !hand.visible) { state[key] = null; continue; }
      hand.updateWorldMatrix(true, false);
      _ndc.setFromMatrixPosition(hand.matrixWorld).project(vmCamera);
      state[key] = { x: +_ndc.x.toFixed(3), y: +_ndc.y.toFixed(3) };
    }

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
      // C2: the raw world heights of both sockets. headAboveFloor is a
      // DIFFERENCE, and a difference cannot distinguish "the head held still
      // while the floor moved" from "neither moved" — nor tell you the hands
      // climbed 0.9 yd while it stayed put. These two can.
      state.assetHeadWorldY = _assetHead.y;
      state.assetGripWorldY = _assetGrip.y;
    } else {
      state.shaftDrop = null;
      state.shaftDropUnit = null;
      state.assetHeadNdc = null;
      state.headAboveFloor = null;
      state.assetHeadWorldY = null;
      state.assetGripWorldY = null;
    }

    return {
      // the sim cleans exactly where the bristles are drawn
      contactX: _headWork.x,
      contactZ: _headWork.z,
      clamped: clampedNow,
      inContact,
      // cleaning must not land while the broom is visibly CARRIED — the sim
      // contact only counts once the pose has blended onto the boards, AND
      // only when the handle can actually reach them (B4).
      planted: workBlendEff > 0.6,
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

  // B2 — the tuning overlay mutates the (cloned, unfrozen) feel object's
  // leaves; almost everything is read per-frame already, and this re-derives
  // the handful of values captured at construction: the viewmodel lens, the
  // elbow offset vectors, the head-lag spring constants, the hand scale,
  // and the arm GEOMETRY (radii/spans live in vertex data).
  function rebuildArmGeometries() {
    const a = feel.arms;
    for (const arm of [right, left]) {
      if (!arm) continue;
      const forearm = arm.forearmPivot.children[0];
      forearm.geometry.dispose();
      forearm.geometry = new THREE.CylinderGeometry(
        a.forearmWristRadius, a.forearmElbowRadius, a.forearmSpan, 14, 1, false,
      );
      forearm.position.z = a.forearmSpan / 2;
      const [cuffRoll, cuffBody] = arm.cuff.children;
      cuffRoll.geometry.dispose();
      cuffRoll.geometry = new THREE.TorusGeometry(a.forearmElbowRadius + 0.012, 0.015, 8, 18);
      cuffBody.geometry.dispose();
      cuffBody.geometry = new THREE.CylinderGeometry(
        a.forearmElbowRadius + 0.008, a.sleeveRadius, 0.09, 12,
      );
      const sleeve = arm.sleevePivot.children[0];
      sleeve.geometry.dispose();
      sleeve.geometry = new THREE.CapsuleGeometry(a.sleeveRadius, a.sleeveLength, 6, 12);
      sleeve.position.z = a.sleeveLength / 2;
    }
  }

  return {
    vmCamera,
    setActive,
    isActive: () => active,
    refreshFromFeel() {
      vmCamera.fov = feel.camera.fov;
      vmCamera.near = feel.camera.near;
      vmCamera.far = feel.camera.far;
      vmCamera.updateProjectionMatrix();
      elbowOffsetRight.set(...feel.arms.elbowOffsetRight);
      elbowOffsetLeft.set(...feel.arms.elbowOffsetLeft);
      HEAD_LAG.stiffness = feel.headLag?.stiffness ?? 128;
      HEAD_LAG.damping = feel.headLag?.damping ?? 15;
      HEAD_LAG.drive = feel.headLag?.drive ?? 0.9;
      HEAD_LAG.maxAngle = feel.headLag?.maxAngle ?? 0.30;
      if (active) fpHands.setHandScale?.(feel.compose.handScale || 1);
      rebuildArmGeometries();
      return true;
    },
    // B3/B4: set [x, y, z] to sweep the hand's camera-space anchor live, or
    // null to go back to the authored value. QA only — no game code calls it.
    setGripAnchorOverride: (next) => {
      gripAnchorOverride = Array.isArray(next) && next.length === 3
        ? [Number(next[0]), Number(next[1]), Number(next[2])]
        : null;
      return gripAnchorOverride;
    },
    update,
    render,
    resize,
    easeInCubic,
    diagnostics: () => ({
      vmActive: active,
      fov: vmCamera.fov,
      layer: feel.camera.layer,
      // Q7: the head's trail, so "it has physics" is a number a driver reads
      // rather than a claim it takes on trust
      headLag: state.headLag || { swinging: false, reason: 'no frame yet', angle: 0, vel: 0 },
      reach: +reach.toFixed(3),
      drawReach: +(state.drawReach ?? reach).toFixed(3),
      // B3: the head's drawn swing, which is what the mop's yarn is driven
      // from. A driver asking "do the strands trail the head" has to correlate
      // against THIS, not against headLag — they are two different oscillators
      // and correlating the wrong pair reports no trail for a perfect one.
      strokeX: +(state.lagX ?? 0).toFixed(4),
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
      // B4: THE FIX'S OWN QUANTITY, WHICH SHIPPED UNREADABLE.
      //
      // `plantAuthority` has been computed and stashed on `state` since the plant
      // gate landed, and `diagnostics()` never returned it — so the one number
      // that says whether the rig believes it may plant could not be read from
      // outside the module. The first sweep driver written against it got `null`
      // on every rung and could say nothing about the rule it was built to test.
      //
      // `floorWorldY` comes with it, because authority is a statement ABOUT the
      // floor plane and a reader who cannot see where that plane is cannot tell
      // a hand below the boards from a hand above them.
      plantAuthority: state.plantAuthority == null ? null : +state.plantAuthority.toFixed(3),
      floorWorldY: state.floorWorldY == null ? null : +state.floorWorldY.toFixed(3),
      assetHeadNdc: state.assetHeadNdc ?? null,
      assetHeadWorldY: state.assetHeadWorldY == null ? null : +state.assetHeadWorldY.toFixed(3),
      assetGripWorldY: state.assetGripWorldY == null ? null : +state.assetGripWorldY.toFixed(3),
      // C2: the grip anchor's world height and how far the up-look cap pulled it
      // down. gripCapYd is 0 wherever the cap is not engaged, so it also says
      // WHERE the behaviour changes without anyone having to read the source.
      gripCamWorldY: state.gripCamWorldY == null ? null : +state.gripCamWorldY.toFixed(3),
      gripCapYd: +(state.gripCapYd ?? 0).toFixed(3),
      gripStowYd: +(state.gripStowYd ?? 0).toFixed(3),
      // where the two hands sit along the shaft (yd back from the bristles),
      // and the current swing of the sweep arc
      gripUpper: +(state.gripUpper ?? 0).toFixed(3),
      gripLower: +(state.gripLower ?? 0).toFixed(3),
      handNdcUpper: state.handNdcUpper ?? null,
      handNdcLower: state.handNdcLower ?? null,
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

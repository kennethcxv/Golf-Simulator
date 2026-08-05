import test from 'node:test';
import assert from 'node:assert/strict';

import { BROOM_FEEL } from '../src/data/broomFeel.js';
// The AUTHORITIES, not copies of them. Every assertion below that used to
// compare a config value against a hand-written literal now compares it
// against the module that owns the number.
import { WALK_SPEED_YD_S, STRIDE_RATE_RAD_S, WALK_FOV_DEG } from '../src/data/locomotion.js';
import { CARRY_RENDER_LAYER } from '../src/render3d/clubhouse.js';
import { CHECKOUT_STANDING_EYE_ABOVE_FLOOR } from '../src/render3d/clubhouse/simplifiedRegisterMode.js';

// Phase 6's tuning surface. Feel itself is judged from renders and clips —
// these pin the CONTRACT: the values live in one frozen config, and the few
// hard ceilings the review set are numbers a test can hold.

test('every feel value lives in the one frozen config', () => {
  assert.ok(Object.isFrozen(BROOM_FEEL), 'the config object is frozen');
  for (const [key, section] of Object.entries(BROOM_FEEL)) {
    assert.equal(typeof section, 'object', `${key} is a section`);
    assert.ok(Object.isFrozen(section), `${key} is frozen`);
  }
});

test('the camera response stays under the review ceiling of 2 degrees', () => {
  assert.ok(BROOM_FEEL.cameraKick.maxDeg > 0, 'there IS a contact response');
  assert.ok(BROOM_FEEL.cameraKick.maxDeg < 2, 'and it stays under 2 degrees');
  assert.ok(BROOM_FEEL.cameraKick.inTime > 0 && BROOM_FEEL.cameraKick.outTime > 0,
    'eased in and out, never a snap');
});

test('the walk bob is locked to the characters\' stride rate', () => {
  // Asserted against the stride rate ITSELF. The previous version compared the
  // config's copy of 8.7 to a retyped 8.7, which checks that two literals
  // match rather than that the tool is in phase with the walk carrying it.
  assert.equal(BROOM_FEEL.walk.bobRate, STRIDE_RATE_RAD_S);
});

test('the viewmodel pass owns its own lens and layer', () => {
  // Both guards read the thing they guard against; they used to compare against
  // retyped literals (66, 30), which would have gone on passing after the walk
  // FOV or the carry layer moved onto the broom's own value.
  assert.notEqual(BROOM_FEEL.camera.fov, WALK_FOV_DEG, 'not hostage to the walk FOV');
  assert.ok(BROOM_FEEL.camera.near < 0.15, 'arms live inside the world near plane');
  assert.notEqual(BROOM_FEEL.camera.layer, CARRY_RENDER_LAYER,
    'distinct from the delivery-carry overlay layer');
});

test('every duration and rate is a positive finite number', () => {
  const timings = [
    BROOM_FEEL.equip.duration, BROOM_FEEL.equip.settleTime,
    BROOM_FEEL.unequip.duration,
    BROOM_FEEL.stroke.rate, BROOM_FEEL.stroke.span,
    BROOM_FEEL.pitch.followRate, BROOM_FEEL.surface.tiltRate,
    BROOM_FEEL.collision.slideRate, BROOM_FEEL.audio.stopTail,
  ];
  for (const value of timings) {
    assert.ok(Number.isFinite(value) && value > 0, `${value} is a positive number`);
  }
});

test('contact particles answer both interior surface kinds', () => {
  // cleaningSurfaceAt reports 'carpet' | 'hard-floor'; a missing entry would
  // silently fall back to one look for every material.
  assert.ok(BROOM_FEEL.particles.surface['hard-floor'], 'hard-floor styled');
  assert.ok(BROOM_FEEL.particles.surface.carpet, 'carpet styled');
});

test('the audio loop answers both interior surface kinds', () => {
  assert.ok(BROOM_FEEL.audio.surface['hard-floor'], 'hard-floor voiced');
  assert.ok(BROOM_FEEL.audio.surface.carpet, 'carpet voiced');
  assert.ok(BROOM_FEEL.audio.surface.carpet.hz < BROOM_FEEL.audio.surface['hard-floor'].hz,
    'carpet is the duller drag, boards the bright bristle');
});

test('the debris push beats the walk speed — dirt recedes, it is not overrun', () => {
  // Walking is 2.2 yd/s. A push slower than that walks OVER its own pile and
  // the debris pops out behind the bristles — the round-1 "dirt lag".
  assert.ok(BROOM_FEEL.dirt.pushSpeed > 2.2,
    `pushSpeed ${BROOM_FEEL.dirt.pushSpeed} must beat the 2.2 yd/s walk`);
  assert.ok(BROOM_FEEL.dirt.maxStep > 0 && BROOM_FEEL.dirt.maxStep < 1,
    'a stroke still cannot fling debris across the room');
});

test('the head-follow spring is under-damped — it settles, it does not snap', () => {
  assert.ok(BROOM_FEEL.weight.lagHz > 0, 'the spring has a natural frequency');
  assert.ok(BROOM_FEEL.weight.lagDamping > 0 && BROOM_FEEL.weight.lagDamping < 1,
    'damping < 1 gives the visible overshoot-and-settle');
});

test('a jam stalls the broom proud instead of folding it vertical', () => {
  // Round 1 pulled the carry pitch down 0.55 rad at a full clamp — a
  // vertical stick at the feet. The stall keeps it a working tool.
  //
  // Round 5: carrySteepen and poseReachFloor are GONE, and this test no longer
  // asks for them. They were the old way of stopping the fold — bend the carry
  // pitch, then floor the reach so the bend could not go too far. The rigid
  // shaft made both unnecessary: the head lies on a sphere of the handle's own
  // measured length about the grip, so shortening the horizontal run RAISES the
  // head up the obstruction instead of folding the shaft toward the feet. The
  // fold is now impossible by construction rather than clamped after the fact.
  // What remains tunable is how the stroke reads while jammed.
  assert.ok(BROOM_FEEL.collision.stallSquash > 0 && BROOM_FEEL.collision.stallSquash < 1,
    'the stroke visibly stalls while jammed rather than stopping dead or ignoring the face');
  assert.ok(BROOM_FEEL.collision.stallIntensity > 0 && BROOM_FEEL.collision.stallIntensity < 1,
    'and the audio/particles calm down with it');
  assert.ok(BROOM_FEEL.collision.standoff > 0,
    'bristles stop AT a blocking face, never inside it');
});

test('the sweep keeps the sim-preserving contact duty it shipped with', () => {
  // duty = (2/PI)*acos(contactCos) — the fraction of each pass in contact.
  const duty = (2 / Math.PI) * Math.acos(BROOM_FEEL.stroke.contactCos);
  assert.ok(duty > 0.45 && duty < 0.75, `duty ${duty.toFixed(3)} stays near the tuned 0.606`);
});

// --- round 3: the play-test rebuild -------------------------------------------
// Each of these pins a specific defect the play-test caught, so the frame
// cannot regress to "broken geometry, not a person sweeping".

test('the sleeve runs DOWN out of frame, never at a point in front of the lens', () => {
  // Round 2 aimed each sleeve at a "shoulder" authored at camera-space z −1.0,
  // a yard IN FRONT of the camera, so it drew a green bar clean across the
  // frame (measured NDC y +0.17 → −3.13). A sleeve direction whose dominant
  // component is anything but downward reintroduces exactly that.
  const [sx, sy, sz] = BROOM_FEEL.arms.sleeveDir;
  assert.ok(sy < 0, 'the sleeve heads downward');
  assert.ok(Math.abs(sy) > Math.abs(sx) && Math.abs(sy) > Math.abs(sz),
    'down dominates, so the sleeve leaves through the bottom edge');
  assert.ok(BROOM_FEEL.arms.sleeveLength <= 0.6,
    'a short sleeve cannot span the frame however it is aimed');
});

test('the grip anchor keeps the hands in frame and close enough to read', () => {
  const [gx, gy, gz] = BROOM_FEEL.compose.gripAnchor;
  assert.ok(gz < 0, 'the hands are in front of the camera');
  assert.ok(Math.abs(gz) > 0.3 && Math.abs(gz) < 0.9,
    'near enough to read as your hands, far enough not to clip the near plane');
  // Framed through the rig's OWN lens. This used to hardcode 50 degrees beside
  // a config that owns the number, so when the lens widened to 78 the test was
  // still grading the composition against a camera that no longer exists.
  // A duplicated constant is a test that can be wrong while staying green.
  const halfH = Math.abs(gz) * Math.tan((BROOM_FEEL.camera.fov * Math.PI) / 180 / 2);
  const ndcY = gy / halfH;
  const ndcX = gx / (halfH * (16 / 9));
  assert.ok(ndcY < 0, `hands sit below the eye line (ndcY ${ndcY.toFixed(2)})`);
  // -0.90 rather than -1.0: AT the edge is not "in frame". Round 5a put the
  // gripping hand at -0.96 and it rendered visibly clipped with its whole
  // forearm off-screen, which passed the old bound of -1 comfortably.
  assert.ok(ndcY > -0.9,
    `hands are clear of the bottom edge, not clipped by it (ndcY ${ndcY.toFixed(2)})`);
  assert.ok(Math.abs(ndcX) < 0.9, `hands sit inside the frame (ndcX ${ndcX.toFixed(2)})`);
});

test('the handle can physically REACH the floor from where the hands are held', () => {
  // THE round-5 bug, as a contract. The hands were held 1.350 yd above the
  // boards while the FP asset measures 1.247 yd from GripPrimary to
  // FloorContact — the broom was 0.103 yd too short to touch the floor, so the
  // bristles hung in mid-air at every pitch and no tuning could ever plant
  // them. Any future change to gripAnchor.y has to keep the reach real.
  //
  // The handle length is the ASSET's, measured from its own sockets at
  // runtime; 1.247 is that measurement recorded here so this test does not
  // need a GLB parser. If the broom asset is re-authored, this number moves.
  // HANDLE_YD is a MEASUREMENT of the shipped FP asset (GripPrimary ->
  // FloorContact), not a constant anything owns, so it stays a literal — but it
  // is a recorded measurement and rots silently if the asset is re-authored.
  // tests/broom-asset-sockets.test.js is where that would be caught; noted here
  // in the D7 sweep as a known-blind rather than dressed up as an authority.
  const HANDLE_YD = 1.247;
  const EYE_YD = CHECKOUT_STANDING_EYE_ABOVE_FLOOR;
  const gripAboveFloor = EYE_YD + BROOM_FEEL.compose.gripAnchor[1];
  assert.ok(gripAboveFloor < HANDLE_YD,
    `the hands are held ${gripAboveFloor.toFixed(3)} yd up but the handle is only `
    + `${HANDLE_YD} yd — the head could never reach the boards`);
  // and with enough left over to reach FORWARD, not just straight down
  const reach = Math.sqrt(HANDLE_YD ** 2 - gripAboveFloor ** 2);
  assert.ok(reach > 0.35,
    `only ${reach.toFixed(3)} yd of forward reach at full plant — the broom would `
    + 'sweep vertically at the player\'s feet');
});

test('the sweep is an arc the head travels, not a sideways nudge', () => {
  assert.ok(BROOM_FEEL.sweep.arcRad > 0.15,
    'the head swings far enough to read as a stroke');
  assert.ok(BROOM_FEEL.sweep.arcRad < 1.2, 'and not so far it whips past the frame');
  assert.ok(BROOM_FEEL.sweep.handFollow > 0 && BROOM_FEEL.sweep.handFollow < 1,
    'the hands follow the head rather than staying rigid');
});

// The carried head's pose used to be pinned here as `carryDrop > 0 && < 0.8`.
// That assertion held through every round of the A8 float, because the bug was
// not the constant's magnitude but WHAT IT WAS MEASURED FROM — yards below
// camera-riding hands rather than above the boards. A range check on a config
// number cannot express that. It now lives in tests/broom-floor-anchor.test.js,
// which drives the real solve across the pitch range.

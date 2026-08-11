// B2 (Goal 20) — the mop's yarn is simulated, and these are the four things the
// brief asked for, each against a control that separates the claim from the
// noise. The rig this replaces would fail every one of them: a lag filter has no
// momentum (no trail, no whip), no floor (no spread), and a literal
// `Math.sin(time * 1.7)` in its rest pose (no stillness).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVerletMopStrands, SHIPPED_MOP_YARN } from '../src/render3d/mopVerlet.js';

const LENGTH = 0.30;
const RADIUS = 0.115;

function makeRig(extra = {}) {
  const material = new THREE.MeshBasicMaterial();
  const rig = createVerletMopStrands({
    THREE, material, count: 48, segments: 4, radius: RADIUS, length: LENGTH, ...extra,
  });
  const head = new THREE.Group();
  head.add(rig.root);
  head.position.set(0, 1, 0);
  head.updateMatrixWorld(true);
  return { rig, head };
}

// Run the sim for a while, optionally moving the head each frame.
function run(rig, head, frames, dt, move = null, floorY = null) {
  for (let f = 0; f < frames; f += 1) {
    if (move) move(f, head);
    head.updateMatrixWorld(true);
    rig.update(dt, floorY);
  }
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
// how far the tips sit from the head's own axis, in the horizontal plane
const spreadOf = (rig, head) => mean(rig.tipsWorld().map(
  (t) => Math.hypot(t.x - head.position.x, t.z - head.position.z),
));
// where the tip cloud's centre sits relative to the head, horizontally
const offsetOf = (rig, head) => {
  const tips = rig.tipsWorld();
  return {
    x: mean(tips.map((t) => t.x)) - head.position.x,
    z: mean(tips.map((t) => t.z)) - head.position.z,
  };
};

test('at rest the yarn hangs straight down and then does not move at all', () => {
  const { rig, head } = makeRig();
  run(rig, head, 240, 1 / 60);
  const tips = rig.tipsWorld();
  // hanging: every tip is roughly a strand-length below the head
  const drop = mean(tips.map((t) => head.position.y - t.y));
  assert.ok(drop > LENGTH * 0.75 && drop < LENGTH * 1.25,
    `settled drop ${drop.toFixed(4)} should be about the strand length ${LENGTH}`);
  // straight: the tip cloud is centred on the head, not blown to one side
  const off = offsetOf(rig, head);
  assert.ok(Math.hypot(off.x, off.z) < 0.004, `resting offset ${Math.hypot(off.x, off.z)}`);

  // AND STILL. This is the direct test for "nothing should read as a canned
  // loop": with the head motionless the drawn state must be bit-identical frame
  // to frame. The rig this replaces had a sine term in its rest pose, so it
  // shimmered forever and would fail here.
  const a = rig.tipsWorld();
  run(rig, head, 30, 1 / 60);
  const b = rig.tipsWorld();
  let worst = 0;
  for (let i = 0; i < a.length; i += 1) worst = Math.max(worst, a[i].distanceTo(b[i]));
  assert.ok(worst < 1e-6, `settled yarn moved ${worst} with a motionless head`);
});

test('moved sideways the yarn trails behind, and settles back when it stops', () => {
  const { rig, head } = makeRig();
  run(rig, head, 180, 1 / 60); // settle first
  const still = offsetOf(rig, head);

  // slide the head along +x at about a walking pace
  run(rig, head, 40, 1 / 60, (f, h) => { h.position.x += 0.03; });
  const moving = offsetOf(rig, head);

  // CONTROL: the resting cloud is centred, so any offset below is the motion
  assert.ok(Math.abs(still.x) < 0.004, `control: resting offset ${still.x}`);
  // trailing means the tips are BEHIND the direction of travel
  assert.ok(moving.x < -0.02,
    `tips should trail behind a +x slide, offset was ${moving.x.toFixed(4)}`);

  // ...then settle: stop the head and the yarn comes back under it
  run(rig, head, 240, 1 / 60);
  const settled = offsetOf(rig, head);
  assert.ok(Math.abs(settled.x) < Math.abs(moving.x) * 0.15,
    `after stopping, offset ${settled.x.toFixed(4)} should relax from ${moving.x.toFixed(4)}`);
});

test('pressed to the floor the yarn spreads and flattens', () => {
  // CONTROL: the same head, the same frames, with the floor out of reach.
  const free = makeRig();
  run(free.rig, free.head, 240, 1 / 60, null, free.head.position.y - 5);
  const freeSpread = spreadOf(free.rig, free.head);
  const freeDrop = mean(free.rig.tipsWorld().map((t) => free.head.position.y - t.y));

  // the same rig with the boards just 40% of a strand-length below the head, so
  // 60% of every strand has nowhere to go but outward
  const planted = makeRig();
  const floorY = planted.head.position.y - LENGTH * 0.4;
  run(planted.rig, planted.head, 240, 1 / 60, null, floorY);
  const plantedSpread = spreadOf(planted.rig, planted.head);
  const plantedDrop = mean(planted.rig.tipsWorld().map((t) => planted.head.position.y - t.y));

  assert.ok(plantedSpread > freeSpread * 1.5,
    `planted spread ${plantedSpread.toFixed(4)} should far exceed free ${freeSpread.toFixed(4)}`);
  assert.ok(plantedDrop < freeDrop * 0.75,
    `planted yarn should be flatter: drop ${plantedDrop.toFixed(4)} vs free ${freeDrop.toFixed(4)}`);
  // and nothing may be below the boards
  const lowest = Math.min(...planted.rig.tipsWorld().map((t) => t.y));
  assert.ok(lowest >= floorY - 1e-3, `a tip sank to ${lowest} through a floor at ${floorY}`);
});

test('a direction change whips the yarn past the head', () => {
  const { rig, head } = makeRig();
  run(rig, head, 180, 1 / 60);
  // drive +x, then reverse to -x
  run(rig, head, 30, 1 / 60, (f, h) => { h.position.x += 0.03; });
  const beforeReversal = offsetOf(rig, head).x;
  assert.ok(beforeReversal < 0, 'precondition: trailing behind the +x drive');

  // one frame after the reversal the cloud is still behind on the OLD side,
  // which now means it is AHEAD of the new travel: that is the whip
  let crossed = 0;
  run(rig, head, 24, 1 / 60, (f, h) => {
    h.position.x -= 0.03;
    if (offsetOf(rig, head).x > 0) crossed += 1;
  });
  assert.ok(crossed > 0,
    'after reversing, the yarn must swing through and past the head at least once');
});

test('the yarn is deterministic and survives a teleport without flinging', () => {
  const a = makeRig();
  const b = makeRig();
  const drive = (f, h) => { h.position.x += 0.02; h.position.z += 0.01; };
  run(a.rig, a.head, 90, 1 / 60, drive);
  run(b.rig, b.head, 90, 1 / 60, drive);
  const ta = a.rig.tipsWorld();
  const tb = b.rig.tipsWorld();
  for (let i = 0; i < ta.length; i += 1) {
    assert.ok(ta[i].distanceTo(tb[i]) < 1e-9, 'two sessions must be identical');
  }

  // a 40-yard jump (equipping, a respawn) must re-seed rather than simulate
  a.head.position.set(40, 1, -25);
  a.head.updateMatrixWorld(true);
  a.rig.update(1 / 60, null);
  const after = a.rig.tipsWorld();
  const far = after.filter((t) => Math.hypot(t.x - 40, t.z + 25) > RADIUS + LENGTH);
  assert.equal(far.length, 0, 'no strand may be left stretched across the room');
});

test('frame rate does not change the settled shape', () => {
  const slow = makeRig();
  const fast = makeRig();
  run(slow.rig, slow.head, 60, 1 / 30);
  run(fast.rig, fast.head, 120, 1 / 60);
  const ds = mean(slow.rig.tipsWorld().map((t) => slow.head.position.y - t.y));
  const df = mean(fast.rig.tipsWorld().map((t) => fast.head.position.y - t.y));
  assert.ok(Math.abs(ds - df) < 0.01, `30 fps drop ${ds} vs 60 fps drop ${df}`);
});

test('B (Goal 22): a string mop is a few thick bands, not a thousand hairs', () => {
  // This assertion used to read `strandCount === 820`, "denser than the old
  // 480", and it was the fifth pass in a row to move this number UP because the
  // disc did not look filled. Filling the disc was the wrong goal: a real string
  // mop is 15-30 thick ropes with visible daylight between them, and the gaps
  // are most of what distinguishes it from a brush. The owner asked for 10-20.
  //
  // The count is asserted as a RANGE rather than a value, because the point is
  // the reading ("a person can count the bands"), not any one number in it.
  const material = new THREE.MeshBasicMaterial();
  const rig = createVerletMopStrands({ THREE, material, ...SHIPPED_MOP_YARN });
  assert.ok(rig.strandCount >= 10 && rig.strandCount <= 20,
    `a string mop has 10-20 bands of yarn, got ${rig.strandCount}`);
  assert.equal(rig.drawCalls, 4, 'still one instanced call per segment index');
  const head = new THREE.Group();
  head.add(rig.root);
  head.position.set(0, 1, 0);
  run(rig, head, 240, 1 / 60);
  const drops = rig.tipsWorld().map((t) => 1 - t.y);
  const spread = Math.max(...drops) - Math.min(...drops);
  assert.ok(spread > LENGTH * 0.2,
    `the hem must be ragged, not machined: length spread was ${spread.toFixed(4)}`);
});

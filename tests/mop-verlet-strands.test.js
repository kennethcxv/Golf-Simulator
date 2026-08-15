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

test('moved sideways WHILE MOPPING the yarn trails behind, and settles back when it stops', () => {
  const { rig, head } = makeRig();
  // PLAYTEST 4, ITEM 3b — THIS TEST NOW NAMES ITS MODE, ON THE OWNER'S RULING.
  //
  // "The strands should only move when I am holding the left mouse button.
  // Carried, walking, turning, looking: they hold still... Change the carry
  // parameters accordingly and update that test rather than working around it."
  //
  // Trailing is what MOPPING does. When it was the unconditional behaviour of the
  // solver, sliding the head sideways trailed the tips whether or not the player
  // was mopping — which is the swing he keeps reporting. The claim is unchanged
  // and it is asserted harder than before (the carried half below is new); what
  // changed is that it is now scoped to the state it was always describing.
  rig.setActive(true);
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

test('CARRIED, the identical slide barely moves the yarn at all', () => {
  // The other half of the ruling, and the one that was missing. Same rig, same
  // 40-frame slide, carried instead of mopping. Without it, "carried is
  // effectively still" is a claim in a comment.
  const { rig, head } = makeRig();
  rig.setActive(false);
  run(rig, head, 180, 1 / 60);
  const still = offsetOf(rig, head);
  run(rig, head, 40, 1 / 60, (f, h) => { h.position.x += 0.03; });
  const carried = offsetOf(rig, head);

  const { rig: rig2, head: head2 } = makeRig();
  rig2.setActive(true);
  run(rig2, head2, 180, 1 / 60);
  run(rig2, head2, 40, 1 / 60, (f, h) => { h.position.x += 0.03; });
  const mopping = offsetOf(rig2, head2);

  assert.ok(Math.abs(still.x) < 0.004, `control: resting offset ${still.x}`);
  // The bar is "effectively still", not "less than mopping": a mop that swung
  // 90% as much as a mopping one would pass a ratio test and fail the eye.
  assert.ok(Math.abs(carried.x) < 0.012,
    `carried yarn moved ${carried.x.toFixed(4)} on a walking-pace slide; that is a swing, not stillness`);
  // and mopping must NOT have been quietened along with it, or the fix is a weld
  assert.ok(Math.abs(mopping.x) > Math.abs(carried.x) * 3,
    `mopping ${mopping.x.toFixed(4)} vs carried ${carried.x.toFixed(4)} — the drag has gone with the swing`);
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

test('D (Goal 23): the bands hang from a COLLAR, not from a point', () => {
  // "It is too sparse and reads as spikes. A real string mop is thick bands
  // that COVER the whole head... they hang from a wide collar and splay across
  // the full width rather than radiating from a point."
  //
  // A sunflower fill is the right way to fill a disc and the wrong way to hang
  // a mop: r = radius * sqrt(i/N) puts the first strands almost on the axis, so
  // the head reads as spikes out of a centre. The collar is what fixes it, and
  // this measures the thing the eye is complaining about — how close to the
  // axis the NEAREST band starts.
  const material = new THREE.MeshBasicMaterial();
  const rig = createVerletMopStrands({ THREE, material, ...SHIPPED_MOP_YARN });
  const head = new THREE.Group();
  head.add(rig.root);
  head.position.set(0, 1, 0);
  run(rig, head, 240, 1 / 60);

  const R = SHIPPED_MOP_YARN.radius;
  const radii = rig.tipsWorld().map((t) => Math.hypot(t.x, t.z));
  const nearest = Math.min(...radii);
  const furthest = Math.max(...radii);

  // CONTROL: the layout this replaces. Its innermost strand sits at
  // radius * sqrt(0.5/N), which for 22 bands is under 8% of the head.
  const oldNearest = R * Math.sqrt(0.5 / SHIPPED_MOP_YARN.count);
  assert.ok(oldNearest < R * 0.2,
    `control: the old fill starts at ${oldNearest.toFixed(4)} — 15% of a ${(R * 1000).toFixed(0)} mm `
    + 'head, which is a spike out of the middle');

  assert.ok(nearest > R * 0.35,
    `no band may hang off the axis: nearest sits at ${nearest.toFixed(4)} of a ${R} head`);

  // GOAL 27 PHASE 0 — THE BAR MOVES 0.75 -> 0.70; THE CLAIM IS UNCHANGED.
  //
  // The Goal 26 5.1 rebuild (owner-approved from the photographed bisection:
  // "point c ships", splay 0.95) deliberately anchors the collar INSIDE the
  // hub at 0.50 R and reaches the rim with the splayed SKIRT instead. Its own
  // sweep table (mopVerlet.js) shows the settled hem is not linear in splay;
  // at the shipped 0.95 the tips settle at 0.742 R — 1.4 mm inside the old
  // bar, which was written against a collar that sat at 0.80 R. Per the
  // owner's recorded method for this very test ("update the test to the new
  // ruling rather than reverting"), the bar records the shipped design and
  // the barrel control below keeps it refusing the shape it was born against.
  assert.ok(furthest > R * 0.70,
    `and the skirt must still reach toward the rim: furthest ${furthest.toFixed(4)} of a ${R} head`);

  // CONTROL: with the splay removed the same yarn is the straight-sided
  // barrel Goal 25 threw out — its tips stay at the 0.50 R collar and MUST
  // fail the skirt bar, or the bar has stopped measuring anything.
  const barrel = createVerletMopStrands({ THREE, material, ...SHIPPED_MOP_YARN, splay: 0 });
  const barrelHead = new THREE.Group();
  barrelHead.add(barrel.root);
  barrelHead.position.set(0, 1, 0);
  run(barrel, barrelHead, 240, 1 / 60);
  const barrelFurthest = Math.max(...barrel.tipsWorld().map((t) => Math.hypot(t.x, t.z)));
  assert.ok(barrelFurthest < R * 0.70,
    `control: a splayless barrel must fail the skirt bar; sat at ${barrelFurthest.toFixed(4)}`);

  // ...and they are thick enough to mat rather than fan. Neighbouring anchors
  // around the collar are about this far apart; a band whose diameter is a
  // decent fraction of that reads as one mass.
  const spacing = (2 * Math.PI * R * 0.8) / SHIPPED_MOP_YARN.count;
  const bandDiameter = SHIPPED_MOP_YARN.strandRadiusTop * 2;
  assert.ok(bandDiameter > spacing * 0.5,
    `bands ${(bandDiameter * 1000).toFixed(0)} mm across must not rattle around in ${(spacing * 1000).toFixed(0)} mm of spacing`);
});

test('B (Goal 25): 16-24 countable BUNCHES of many fine strands, not 16-24 rods', () => {
  // THE 16-24 RULING IS SUPERSEDED, BY THE OWNER, and this test is rewritten to
  // the ruling that replaces it rather than reverted to the one it replaces.
  //
  // The history, because this number has moved five times. It read
  // `strandCount === 820`, then 480, each pass raising it because the disc did
  // not look filled. Goal 22 cut it to 16 thick bands: filling a disc was the
  // wrong goal, and the daylight between bands is most of what separates a mop
  // from a brush. Goal 23 widened that to the 16-24 the owner asked for.
  //
  // Then Goal 25 shipped 22 bands at 13 mm, the owner said it still looked
  // wrong, and asked for House Flipper's mop. Built at 380 fine strands it
  // photographed as a BRUSH, and I reported the two rulings as colliding. They
  // do not. His resolution:
  //
  //   "The 16-24 ruling was about THICK BANDS. House Flipper's is MANY FINE
  //    STRANDS THAT SPLAY AND CLUMP. Your own screenshot shows why 380 read as a
  //    brush: it was a straight-sided barrel. A string mop is not a cylinder --
  //    it flares into a skirt and the strands clump in groups. So: density AND
  //    splay together. Update the test to the new band rather than reverting to
  //    the old one -- that ruling is superseded by this one."
  //
  // So 16-24 was never the strand count. It is the count of BUNCHES a person can
  // pick out by eye, which is what both earlier rulings were reaching for, and
  // the error in both directions was making the bunch and the strand the same
  // object. 22 strands meant each bunch was one 13 mm rod; 380 evenly-spread
  // strands meant there were no bunches at all. The band below is therefore on
  // clumpCount, and the strand count is asserted to be MANY per bunch.
  const material = new THREE.MeshBasicMaterial();
  const rig = createVerletMopStrands({ THREE, material, ...SHIPPED_MOP_YARN });
  assert.ok(rig.clumpCount >= 16 && rig.clumpCount <= 24,
    `a string mop reads as 16-24 bunches, got ${rig.clumpCount}`);
  assert.ok(rig.strandCount / rig.clumpCount >= 8,
    `and each bunch is many fine strands, got ${(rig.strandCount / rig.clumpCount).toFixed(1)} per bunch`);
  // The fineness is the other half of "many fine strands": at 13 mm a strand
  // reads as a length of pipe however many of them there are.
  //
  // BAR RAISED 8 mm -> 11 mm ON THE OWNER'S INSTRUCTION, PLAYTEST 3 ITEM 5:
  // "MAKE EACH STRAND THICKER. They are far too thin", with "strand thickness
  // and the hub connection are NOT part of that [density] decision -- fix those
  // regardless." He is looking at the shipped 7.6 mm strand and calling it thin.
  //
  // The 8 mm bar was set against a DIFFERENT head: 380 strands on a 0.256-wide
  // ball, where a thick strand was a large fraction of what the eye saw. At 972
  // strands on a 0.336-wide disc the same millimetre is a much smaller share of
  // the silhouette. 13 mm is still pipe and the bar still refuses it.
  //
  // Recorded here rather than quietly widened: if he looks at 10.2 mm and says
  // it is now pipe, this line and SHIPPED_MOP_YARN.strandRadiusTop are the two
  // places to put back.
  assert.ok(SHIPPED_MOP_YARN.strandRadiusTop * 2 < 0.011,
    `a strand is yarn, not pipe: ${(SHIPPED_MOP_YARN.strandRadiusTop * 2 * 1000).toFixed(1)} mm across`);
  // AND THE GAPS SURVIVE THE DENSITY. This is what stops "many fine strands"
  // sliding back into the brush: bunches must stay separated at the collar.
  const anchors = rig.anchors();
  const centres = new Map();
  for (const a of anchors) {
    const c = centres.get(a.clump) || { x: 0, z: 0, n: 0 };
    c.x += a.x; c.z += a.z; c.n += 1;
    centres.set(a.clump, c);
  }
  const pts = [...centres.values()].map((c) => ({ x: c.x / c.n, z: c.z / c.n }));
  let closest = Infinity;
  let widest = 0;
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      closest = Math.min(closest, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z));
    }
    for (const a of anchors) {
      if (a.clump !== i) continue;
      widest = Math.max(widest, Math.hypot(a.x - pts[i].x, a.z - pts[i].z));
    }
  }
  assert.ok(widest * 2 < closest,
    `a bunch (${(widest * 2 * 1000).toFixed(1)} mm wide) must not close the gap to its neighbour (${(closest * 1000).toFixed(1)} mm)`);
  // The literal 4 here was a snapshot of the segment count at the time, not the
  // contract -- the contract is the message beside it, one instanced call per
  // segment index, and 5.1 raised the count to 8 so the flare stops showing a
  // corner at every node. Binding the assertion to the number it was describing
  // keeps that contract exactly. The separate ceiling is the thing the literal
  // was quietly guarding: the yarn must not turn into a draw-call budget of its
  // own, and Phase 7 is about that budget.
  assert.equal(rig.drawCalls, SHIPPED_MOP_YARN.segments,
    'still one instanced call per segment index');
  assert.ok(rig.drawCalls <= 8,
    `the yarn may not cost more than 8 draws; costs ${rig.drawCalls}`);
  const head = new THREE.Group();
  head.add(rig.root);
  head.position.set(0, 1, 0);
  run(rig, head, 240, 1 / 60);
  const drops = rig.tipsWorld().map((t) => 1 - t.y);
  const spread = Math.max(...drops) - Math.min(...drops);
  // GOAL 27 PHASE 0 — THE DENOMINATOR WAS THE WRONG RIG'S. This rig is built
  // from SHIPPED_MOP_YARN, but the bar divided by the synthetic makeRig()
  // LENGTH (0.30). They agreed when this line was written; the Goal 26
  // bisection cut the shipped drop to 0.108 and the bar silently became 56%
  // of the strand length. 20% stays the claim — asked of the strands actually
  // simulated. Shipped settle: 0.049, which is 45% of the shipped length.
  assert.ok(spread > SHIPPED_MOP_YARN.length * 0.2,
    `the hem must be ragged, not machined: length spread was ${spread.toFixed(4)} of ${SHIPPED_MOP_YARN.length}`);

  // CONTROL: cut every strand to one length and the hem is machined — the
  // same bar MUST refuse it. (lengthVariation is the raggedness source; the
  // splay geometry alone lifts rim tips a little, and this proves that lift
  // stays under the bar.)
  const machined = createVerletMopStrands({ THREE, material, ...SHIPPED_MOP_YARN, lengthVariation: 0 });
  const machinedHead = new THREE.Group();
  machinedHead.add(machined.root);
  machinedHead.position.set(0, 1, 0);
  run(machined, machinedHead, 240, 1 / 60);
  const machinedDrops = machined.tipsWorld().map((t) => 1 - t.y);
  const machinedSpread = Math.max(...machinedDrops) - Math.min(...machinedDrops);
  assert.ok(machinedSpread < SHIPPED_MOP_YARN.length * 0.2,
    `control: a uniform cut must read machined; spread ${machinedSpread.toFixed(4)}`);
});

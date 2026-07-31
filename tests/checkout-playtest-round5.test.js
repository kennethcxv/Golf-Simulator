// CHECKOUT PLAYTEST, ROUND 5 (2026-07-30). Three reported items, held as
// contracts so they cannot drift back. Whether they LOOK right is held by
// tools/qa/checkout-round5-renders.js against Designs/CashRegister/Final and
// the 2026-07-30 counter screenshot; these are the invariants underneath:
//   A "why is the view of the checkout like birds eye view? … not a 10ft tall
//     cashier" — the working frame's eye is PINNED to a standing person's eye
//     line and the customer's head crops off the top
//   B "when hovering over an item don't have the orange box around it anymore"
//     — and the GREEN payment rim stays
//   C "look at how the bag is laid flat and it's long, opened, and small height"
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import {
  CHECKOUT_BAG_PRESENTATION,
  CHECKOUT_CUSTOMER_HANDS_Y,
  CHECKOUT_CUSTOMER_SHOULDER_Y,
  CHECKOUT_DISPLAY_BRAND_PRESENTATION,
  CHECKOUT_STAFF_FLOOR_Y,
  CHECKOUT_STANDING_EYE_ABOVE_FLOOR,
  CHECKOUT_WORKING_EYE_Y,
  CHECKOUT_WORKING_FOV,
} from '../src/render3d/clubhouse/simplifiedRegisterMode.js';
import { COUNTER_TOP, FRONT_DESK_FRAME, REGISTER, frontDeskLocalPoint } from '../src/data/shopLayout.js';

const source = fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  let cursor = source.indexOf('(', start);
  let parens = 0;
  for (; cursor < source.length; cursor += 1) {
    if (source[cursor] === '(') parens += 1;
    if (source[cursor] === ')' && --parens === 0) break;
  }
  const open = source.indexOf('{', cursor);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} has an unterminated body`);
}

// The desk frame's own quaternion builder, mirrored from the runtime.
function frontDeskQuaternion(pitch = 0, yaw = 0, roll = 0) {
  return new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), FRONT_DESK_FRAME.ry)
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll)));
}

async function loadGlb(url) {
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'round5-texture-stub',
    loadTexture: async () => new THREE.Texture(),
  }));
  const bytes = await fs.promises.readFile(url);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => loader.parse(data, '', resolve, reject));
}

// --- A: the eye line -------------------------------------------------------

test('the working eye is a standing person, not a ten-foot cashier', () => {
  const aboveFloor = CHECKOUT_WORKING_EYE_Y - CHECKOUT_STAFF_FLOOR_Y;
  // The game already knows how tall a person is: the walking player's eye rides
  // 1.62 above the ground they stand on. The cashier IS that person.
  assert.equal(CHECKOUT_STANDING_EYE_ABOVE_FLOOR, 1.62);
  assert.equal(aboveFloor, CHECKOUT_STANDING_EYE_ABOVE_FLOOR);
  assert.ok(aboveFloor >= 1.45 && aboveFloor <= 1.80,
    `the checkout eye stands ${aboveFloor.toFixed(2)} above the staff floor — outside human range`);
  // The measured regression: the round-4 solve floated to 1.99 above the floor.
  assert.ok(aboveFloor < 1.90, 'anything approaching 1.99 above the floor is the reported bird\'s-eye');
  // …and it must sit BELOW a standing customer's crown, or no amount of tilt can
  // ever crop their head and the frame is looking DOWN on the person opposite.
  const crown = CHECKOUT_STAFF_FLOOR_Y + 1.66;
  assert.ok(CHECKOUT_WORKING_EYE_Y < crown,
    `eye ${CHECKOUT_WORKING_EYE_Y} must be under the customer's crown ${crown}`);
  // It is still comfortably above the thing it works on.
  assert.ok(CHECKOUT_WORKING_EYE_Y - COUNTER_TOP > 0.55, 'the eye clears the counter it works');
});

test('the framing solver can pin the eye height and solve only the standoff', () => {
  const solver = functionBody('solveFramingPose');
  assert.match(solver, /eyeY = null/, 'the solver takes an eye-height constraint');
  assert.match(solver, /framingProbe\.position\.y = eyeY/, 'and it holds the eye on that plane');
  assert.match(solver, /framingBackFlat/, 'the standoff walked under the constraint is horizontal');
  const solved = functionBody('derivedWorkingPose');
  assert.match(solved, /eyeY: interior\.position\.y \+ CHECKOUT_WORKING_EYE_Y/,
    'the working frame uses it — poses are interior-local, the solve is world');
});

test('the working frame stops asking to contain the customer\'s head', () => {
  const solved = functionBody('derivedWorkingPose');
  // The round-4 solve pushed the CROWN through the framing solver. A frame that
  // must hold a whole standing adult across a counter can only be shot from
  // above them, which is exactly the bird's-eye that was reported.
  assert.ok(!solved.includes('1.66'), 'the crown is no longer a framing subject');
  assert.match(solved, /CHECKOUT_CUSTOMER_HANDS_Y/,
    'the customer is held only to their hands at the counter');
  assert.ok(CHECKOUT_CUSTOMER_HANDS_Y < CHECKOUT_CUSTOMER_SHOULDER_Y);
  assert.ok(CHECKOUT_STAFF_FLOOR_Y + CHECKOUT_CUSTOMER_HANDS_Y < CHECKOUT_WORKING_EYE_Y,
    'the retained customer subject sits below the eye, so it cannot lift the camera');
  // Full containment of every subject is retired as an acceptance: the reference
  // crops the customer, so the working margins may exceed the frame.
  assert.match(source, /const WORK_POSE_MARGIN_X = 1\.\d+/,
    'the counter kit is allowed to kiss and slightly overrun the frame edges');
});

test('the checkout lens is wide enough to stand at the counter', () => {
  // 48.5 could only fit ~2 yd of counter kit from a yard and a half back, and
  // from there a standing eye sees the desk apron, not the desk top.
  assert.ok(CHECKOUT_WORKING_FOV >= 50 && CHECKOUT_WORKING_FOV <= 62,
    `working fov ${CHECKOUT_WORKING_FOV} is outside the usable band`);
  const poses = source.slice(source.indexOf('const MIXED_POSE'), source.indexOf('const POSES ='));
  assert.match(poses, /fov: CHECKOUT_WORKING_FOV/,
    'the authored fallback shares the derived frame\'s lens, so mounting the bag is not a zoom');
});

// --- B: the orange hover box ------------------------------------------------

test('nothing draws an orange box around a hovered item any more', () => {
  assert.ok(!/hoverBox|hoverBounds/.test(source),
    'the brass Box3Helper and its bounds are deleted, not merely hidden');
  assert.ok(!source.includes('0xb9974e), '),
    'no Box3Helper is constructed with the brass hover colour');
  const move = functionBody('onMove');
  assert.ok(!move.includes('Box3Helper'));
  // The cursor still says "clickable" — the affordance moved, it did not vanish.
  assert.match(move, /setHoverCursor\(!!hoveredItem\)/);
});

test('the green payment rim the playtest asked for is untouched', () => {
  assert.match(source, /const GRAB_OUTLINE_COLOR = 0x2ecc40/);
  const grab = functionBody('setGrabOutline');
  assert.match(grab, /grabBox\.visible = true/);
  assert.match(grab, /grabBoxOuter\.visible = true/, 'two nested shells read as one thick rim');
  assert.match(grab, /grabGlow\.visible = true/, 'and the additive halo carries at frame distance');
  const move = functionBody('onMove');
  assert.match(move, /setGrabOutline\(offered\)/, 'offered payment still rims green under the cursor');
  const cash = functionBody('updateCashHover');
  assert.match(cash, /setGrabOutline\(offered\)/);
});

// --- C: the bag lies flat, long, open, and low ------------------------------

test('the carrier is authored on its face with its mouth down-counter', () => {
  const q = frontDeskQuaternion(
    CHECKOUT_BAG_PRESENTATION.pitch, 0, CHECKOUT_BAG_PRESENTATION.roll,
  );
  const axis = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(q);
  // The model's +Y is its mouth, +Z its printed front face, +X its width.
  const mouth = axis(0, 1, 0);
  const face = axis(0, 0, 1);
  assert.ok(face.y > 0.999, 'the printed face turns UP — the bag lies on its front');
  assert.ok(Math.abs(mouth.y) < 0.001, 'the mouth points along the counter, not at the ceiling');
  // Desk-local +x is where the staged goods are; the mouth must aim at them.
  // frontDeskLocalPoint takes a world POINT, so offset the direction by the
  // frame origin — which maps to desk-local (0, 0) — to read it as a direction.
  const mouthLocal = frontDeskLocalPoint(
    FRONT_DESK_FRAME.x + mouth.x, FRONT_DESK_FRAME.z + mouth.z,
  );
  assert.ok(mouthLocal.x > 0.999,
    `the mouth faces the bare counter to its right (local x ${mouthLocal.x.toFixed(3)})`);
});

test('the laid carrier is long, low and clear of the goods', async () => {
  const loaded = await loadGlb(new URL('../assets/checkout/glb/shopping_bag.glb', import.meta.url));
  const model = loaded.scene;
  // The runtime hides collision proxies and the two legacy club marks; nothing
  // else is suppressed, because the rest of it is the bag.
  for (const name of CHECKOUT_DISPLAY_BRAND_PRESENTATION.legacyNodes.shoppingBag) {
    const node = model.getObjectByName(name);
    if (node) node.visible = false;
  }
  model.traverse((object) => {
    if (/^(?:COL_|COLLISION_|VOLUME_)/i.test(String(object.name || ''))) object.visible = false;
  });
  model.scale.z = CHECKOUT_BAG_PRESENTATION.flatten;

  const group = new THREE.Group();
  group.position.set(
    REGISTER.bag.x,
    COUNTER_TOP + CHECKOUT_BAG_PRESENTATION.counterLift,
    REGISTER.bag.z,
  );
  group.quaternion.copy(frontDeskQuaternion(
    CHECKOUT_BAG_PRESENTATION.pitch, 0, CHECKOUT_BAG_PRESENTATION.roll,
  ));
  group.scale.setScalar(CHECKOUT_BAG_PRESENTATION.scale);
  group.add(model);
  group.updateWorldMatrix(true, true);

  const bounds = new THREE.Box3();
  model.traverseVisible((object) => {
    const position = object.isMesh && object.geometry?.attributes?.position;
    if (!position) return;
    const point = new THREE.Vector3();
    for (let index = 0; index < position.count; index += 1) {
      bounds.expandByPoint(point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld));
    }
  });
  assert.ok(!bounds.isEmpty(), 'the carrier has visible geometry');
  const size = bounds.getSize(new THREE.Vector3());

  // FLAT: it sits ON the counter top, not through it and not hovering.
  assert.ok(bounds.min.y >= COUNTER_TOP - 0.004,
    `the laid flank rests on the counter (min y ${bounds.min.y.toFixed(4)} vs top ${COUNTER_TOP})`);
  assert.ok(bounds.min.y <= COUNTER_TOP + 0.010, 'and it is not floating above it');

  // LONG and SMALL HEIGHT: the reference carrier is about a quarter of its own
  // length off the surface. The un-flattened bag was 56% — a carton.
  const along = frontDeskLocalPoint(bounds.max.x, bounds.max.z);
  const back = frontDeskLocalPoint(bounds.min.x, bounds.min.z);
  const length = Math.abs(along.x - back.x);
  const across = Math.abs(along.z - back.z);
  assert.ok(length > across, `the long axis runs down the counter (${length.toFixed(3)} vs ${across.toFixed(3)})`);
  assert.ok(size.y / length < 0.36,
    `laid height ${size.y.toFixed(3)} is not small against length ${length.toFixed(3)}`);
  assert.ok(CHECKOUT_BAG_PRESENTATION.flatten < 0.7, 'the gusset is collapsed, not just tipped over');

  // OPEN, INTO CLEAR COUNTER: the mouth must stop short of the staged goods, so
  // there is a bare stretch to its right for scanned product (reference 154641).
  const mouthLocal = frontDeskLocalPoint(bounds.max.x, bounds.max.z).x;
  const stagingLocal = Math.min(
    frontDeskLocalPoint(REGISTER.staging.minX, REGISTER.staging.minZ).x,
    frontDeskLocalPoint(REGISTER.staging.minX, REGISTER.staging.maxZ).x,
  );
  assert.ok(mouthLocal < stagingLocal,
    `the mouth (local x ${mouthLocal.toFixed(3)}) stops clear of the goods (${stagingLocal.toFixed(3)})`);

  // …and the whole footprint stays on the counter's staff half, not over an edge.
  for (const [x, z] of [[bounds.min.x, bounds.min.z], [bounds.max.x, bounds.max.z]]) {
    const local = frontDeskLocalPoint(x, z);
    assert.ok(Math.abs(local.z) < FRONT_DESK_FRAME.frontDepth / 2,
      `the carrier stays on the counter (local z ${local.z.toFixed(3)})`);
  }
});

test('the interior reads as a cavity and the front of the bag is real paper', () => {
  const style = functionBody('applyKraftBagStyle');
  assert.match(style, /liner/, 'the authored liner is darkened so the mouth reads as an opening');
  assert.match(source, /const BAG_LINER_COLOR = 0x[0-9a-f]{6}/);
  const liner = Number.parseInt(source.match(/const BAG_LINER_COLOR = (0x[0-9a-f]{6})/)[1], 16);
  const kraft = 0xc09a65;
  const luma = (hex) => ((hex >> 16) & 255) * 0.3 + ((hex >> 8) & 255) * 0.59 + (hex & 255) * 0.11;
  assert.ok(luma(liner) < luma(kraft) * 0.6, 'the cavity is clearly darker than the paper around it');
  assert.match(style, /styled\.map = null/,
    'the authored club marks come off as a TEXTURE, which is why the face can stay');
  // The build must flatten the model, never the group: the group's uniform scale
  // is read by the handoff drag, the delivery tween and save/restore.
  const build = functionBody('buildBag');
  assert.match(build, /model\.scale\.z = BAG_FLATTEN/);
  assert.match(build, /builtBag\.scale\.setScalar\(BAG_COUNTER_SCALE\)/);
});

test('a bag lifted to the customer is righted from its resting pose, not snapped', () => {
  const delivery = functionBody('updateDelivery');
  assert.match(delivery, /bagGroup\.quaternion\.copy\(bagCounterQuaternion\(\)\)\s*\n\s*\.slerp\(/,
    'the handoff interpolates FROM the laid pose — identity would snap it upright');
});

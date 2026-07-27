// Framing invariants for the card-payment camera. The handoff frames the
// customer, then the entry camera moves close enough to read a reader that stays
// physically seated on the counter. The reader itself never rises or floats.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  cardHandoffPose, cardTerminalPose, fulfillmentHandoffPose,
} from '../src/render3d/clubhouse/registerCameraPoses.js';
import {
  buildCatalogProductProxy, catalogCheckoutLayout,
} from '../src/render3d/clubhouse/catalogProductVisual.js';
import {
  CHECKOUT_BAG_PRESENTATION, CHECKOUT_DISPLAY_BRAND_PRESENTATION, checkoutLookScale,
  receiptGeometryUsesFeedAxis,
} from '../src/render3d/clubhouse/simplifiedRegisterMode.js';
import { skuById } from '../src/data/shopItems.js';
import {
  COUNTER_TOP, FRONT_DESK_FRAME, REGISTER, frontDeskLocalPoint, frontDeskPoint, queueSlot,
} from '../src/data/shopLayout.js';

const STATION = REGISTER.cardterm;
const CUSTOMER = queueSlot(0);
const registerSource = fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} has an unterminated body`);
}

function makeGlbLoader() {
  const loader = new GLTFLoader();
  // Node has no browser image decoder. Geometry and scene transforms are the
  // camera contract here, so a texture stub mirrors the asset validation tests.
  loader.register(() => ({
    name: 'register-camera-texture-stub',
    loadTexture: async () => new THREE.Texture(),
  }));
  return loader;
}

async function loadGlb(url) {
  const bytes = await fs.promises.readFile(url);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => makeGlbLoader().parse(data, '', resolve, reject));
}

function prepareRuntimeAsset(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    if (object.userData?.collision_proxy
        || /^(?:COL_|COLLISION_|VOLUME_)/i.test(String(object.name || ''))) {
      object.visible = false;
    }
  });
  return root;
}

function visibleProjectionBounds(root, camera) {
  root.updateWorldMatrix(true, true);
  const bounds = {
    minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity,
    minZ: Infinity, maxZ: -Infinity, vertices: 0,
  };
  const point = new THREE.Vector3();
  root.traverseVisible((object) => {
    const position = object.isMesh && object.geometry?.attributes?.position;
    if (!position) return;
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld).project(camera);
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxY = Math.max(bounds.maxY, point.y);
      bounds.minZ = Math.min(bounds.minZ, point.z);
      bounds.maxZ = Math.max(bounds.maxZ, point.z);
      bounds.vertices += 1;
    }
  });
  assert.ok(bounds.vertices > 0, `${root.name || 'checkout subject'} has visible geometry`);
  return bounds;
}

test('handoff frames the customer across the counter, not the counter surface', () => {
  const p = cardHandoffPose(CUSTOMER, COUNTER_TOP);
  const eye = frontDeskLocalPoint(p.eye.x, p.eye.z);
  const look = frontDeskLocalPoint(p.look.x, p.look.z);
  const customer = frontDeskLocalPoint(CUSTOMER.x, CUSTOMER.z);
  // Eye on local +z (the staff side), at standing height.
  assert.ok(eye.z > FRONT_DESK_FRAME.frontDepth / 2, `eye is on the staff side (local z=${eye.z})`);
  assert.ok(p.eye.y > 1.4 && p.eye.y < 1.8, `eye at standing height (y=${p.eye.y})`);
  assert.ok(look.z < eye.z, 'looks from local staff side toward the customer');
  assert.ok(Math.abs(look.z - customer.z) < 0.6, 'look point is at the customer, not mid-counter');
  assert.ok(p.look.y > COUNTER_TOP + 0.15, `look point is at chest height, not the countertop (y=${p.look.y})`);
  // The aim is only gently downward so the customer's torso remains in frame.
  const dropAngle = Math.atan2(p.eye.y - p.look.y, Math.hypot(p.eye.x - p.look.x, p.eye.z - p.look.z));
  assert.ok(dropAngle < 0.35, `handoff is not a steep look-down (${dropAngle.toFixed(2)} rad)`);
});

test('handoff keeps the customer in frame no matter where they stand', () => {
  for (const cx of [-1.4, -0.8, -0.2, 0.4, 1.2]) {
    const customer = frontDeskLocalPoint(CUSTOMER.x, CUSTOMER.z);
    const point = frontDeskPoint(cx, customer.z);
    const p = cardHandoffPose(point, COUNTER_TOP);
    const look = frontDeskLocalPoint(p.look.x, p.look.z);
    assert.ok(look.x >= -0.75 - 1e-9 && look.x <= 0.25 + 1e-9,
      `look x clamped into the frame for local cx=${cx} (got ${look.x})`);
  }
});

test('terminal entry frames the fixed reader with a close downward view', () => {
  const terminal = cardTerminalPose(STATION, COUNTER_TOP);
  const eye = frontDeskLocalPoint(terminal.eye.x, terminal.eye.z);
  const look = frontDeskLocalPoint(terminal.look.x, terminal.look.z);
  const station = frontDeskLocalPoint(STATION.x, STATION.z);
  assert.equal(cardTerminalPose.length, 2, 'the fixed pose has no lift or float parameters');
  // Aim stays at the seated device, only slightly above the physical countertop.
  assert.ok(terminal.look.y >= COUNTER_TOP, 'look point is not below the counter');
  assert.ok(terminal.look.y < COUNTER_TOP + 0.15, 'look point stays on the seated reader');
  // Eye is close and above the keypad for a readable, natural downward glance.
  assert.ok(terminal.eye.y > terminal.look.y, 'eye is above the reader');
  assert.ok(terminal.eye.y < COUNTER_TOP + 0.60, 'eye stays close instead of simulating a reader lift');
  const distance = Math.hypot(
    terminal.eye.x - terminal.look.x,
    terminal.eye.y - terminal.look.y,
    terminal.eye.z - terminal.look.z,
  );
  assert.ok(distance < 1.1, `reader view is close enough to read (${distance.toFixed(2)})`);
  assert.ok(eye.z > station.z, 'eye is on the local staff side of the terminal');
  assert.ok(look.z < eye.z, 'looks toward the customer side at the terminal');
});

test('handoff and terminal poses share one desk-local direction with no 180 spin', () => {
  const handoff = cardHandoffPose(CUSTOMER, COUNTER_TOP);
  const terminal = cardTerminalPose(STATION, COUNTER_TOP);
  const handoffEye = frontDeskLocalPoint(handoff.eye.x, handoff.eye.z);
  const handoffLook = frontDeskLocalPoint(handoff.look.x, handoff.look.z);
  const terminalEye = frontDeskLocalPoint(terminal.eye.x, terminal.eye.z);
  const terminalLook = frontDeskLocalPoint(terminal.look.x, terminal.look.z);
  assert.ok(handoffLook.z - handoffEye.z < 0, 'handoff looks toward local customer -z');
  assert.ok(terminalLook.z - terminalEye.z < 0, 'terminal looks toward local customer -z');
  assert.ok(Math.abs(handoff.eye.x - terminal.eye.x) < 1.2, 'eyes are near each other in x');
});

test('card presentation keeps the customer-facing pose until automatic insertion begins', () => {
  const poseKey = functionBody(registerSource, 'poseKey');
  assert.match(
    poseKey,
    /tx\.stage === 'card-present' && cardPresentationTimer > 0/,
    'the customer presentation beat remains part of the card-take camera condition',
  );
  assert.match(
    poseKey,
    /return waiting \? 'cardTake' : 'card'/,
    'the camera moves to the terminal only after the customer handoff clears',
  );
});

test('fixed register views and fallback payment handoffs follow the rotated desk frame', () => {
  const poseStart = registerSource.indexOf('const MIXED_POSE');
  const poseEnd = registerSource.indexOf('const CAMERA_TWEEN_SECONDS', poseStart);
  const poseSource = registerSource.slice(poseStart, poseEnd);
  const authoredPoints = [
    'deskCameraPoint(0.18, 1.70, 1.18)',
    'deskCameraPoint(0.16, 1.16, 0.00)',
    'deskCameraPoint(0.52, 1.26, 0.82)',
    'deskCameraPoint(0.52, 1.41, 0.24)',
    'deskCameraPoint(0.32, 1.82, 1.46)',
    'deskCameraPoint(0.22, 1.04, 0.22)',
  ];
  for (const point of authoredPoints) {
    assert.ok(poseSource.includes(point), `${point} remains authored in desk-local space`);
  }

  for (const [eyeX, eyeZ, lookX, lookZ] of [
    [0.18, 1.18, 0.16, 0.00],
    [0.52, 0.82, 0.52, 0.24],
    [0.32, 1.46, 0.22, 0.22],
  ]) {
    const eyeWorld = frontDeskPoint(eyeX, eyeZ);
    const lookWorld = frontDeskPoint(lookX, lookZ);
    const eye = frontDeskLocalPoint(eyeWorld.x, eyeWorld.z);
    const look = frontDeskLocalPoint(lookWorld.x, lookWorld.z);
    assert.ok(eye.z > look.z, 'each fixed view looks from local staff +z toward customer -z');
  }

  const customerPosition = functionBody(registerSource, 'customerLocalPosition');
  assert.match(customerPosition, /queueSlot\(0\)/, 'missing customers fall back to the canonical queue head');
  assert.doesNotMatch(customerPosition, /1\.60|3\.05/, 'the former absolute queue point is gone');

  const handPoint = functionBody(registerSource, 'customerHandPoint');
  assert.match(handPoint, /frontDeskLocalPoint\(at\.x, at\.z\)/);
  assert.match(handPoint, /frontDeskPoint\([\s\S]*?-0\.30/);
  const customer = frontDeskLocalPoint(CUSTOMER.x, CUSTOMER.z);
  const handWorld = frontDeskPoint(Math.max(-0.90, Math.min(0.50, customer.x)), -0.30);
  const hand = frontDeskLocalPoint(handWorld.x, handWorld.z);
  assert.ok(customer.z < hand.z, 'card and cash travel from the queue toward the counter');
  assert.ok(hand.z < 0, 'the fallback handoff remains on the customer half');
});

test('mixed working camera contains the full bag, staged goods, and enlarged POS at 16:9', async () => {
  const eye = { ...frontDeskPoint(0.18, 1.18), y: 1.70 };
  const look = { ...frontDeskPoint(0.16, 0.00), y: 1.16 };
  const dx = look.x - eye.x;
  const dy = look.y - eye.y;
  const dz = look.z - eye.z;
  const horizontal = Math.hypot(dx, dz) || 1;
  const camera = new THREE.PerspectiveCamera(48.5, 16 / 9, 0.1, 100);
  camera.position.set(eye.x, eye.y, eye.z);
  camera.rotation.set(
    Math.atan2(dy, horizontal),
    Math.atan2(-dx / horizontal, -dz / horizontal),
    0,
    'YXZ',
  );
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  const productIds = ['tees1', 'marker1', 'glove1'];
  const productModels = [
    ['checkout_product_tee_pouch', 'checkout_product_tee_pouch.glb'],
    ['checkout_product_marker_blister', 'checkout_product_marker_blister.glb'],
    ['checkout_product_glove', 'checkout_product_glove.glb'],
  ];
  const productAssets = new Map(await Promise.all(productModels.map(async ([name, file]) => {
    const loaded = await loadGlb(new URL(`../vendor/models/clubhouse/${file}`, import.meta.url));
    return [name, prepareRuntimeAsset(loaded.scene)];
  })));
  const merch = {
    has: (name) => productAssets.has(name),
    instantiate: (name) => prepareRuntimeAsset(productAssets.get(name).clone(true)),
  };
  const productPoses = catalogCheckoutLayout(
    productIds.map((id) => ({ sku: skuById(id) })),
    REGISTER.staging,
    COUNTER_TOP + 0.012,
  );

  const bagAsset = prepareRuntimeAsset((await loadGlb(new URL(
    '../assets/checkout/glb/shopping_bag.glb', import.meta.url,
  ))).scene);
  const legacyBagArt = bagAsset.getObjectByName('Bag_Body_2');
  if (legacyBagArt) legacyBagArt.visible = false;
  const bag = new THREE.Group();
  bag.name = 'production shopping bag';
  const bagDatum = frontDeskLocalPoint(REGISTER.bag.x, REGISTER.bag.z);
  const bagCounterPosition = frontDeskPoint(bagDatum.x, bagDatum.z - 0.16);
  bag.position.set(
    bagCounterPosition.x,
    COUNTER_TOP + CHECKOUT_BAG_PRESENTATION.counterLift,
    bagCounterPosition.z,
  );
  bag.quaternion
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), FRONT_DESK_FRAME.ry)
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(
      CHECKOUT_BAG_PRESENTATION.pitch,
      0,
      0,
    )));
  bag.scale.setScalar(CHECKOUT_BAG_PRESENTATION.scale);
  bag.add(bagAsset);
  const bagPanel = CHECKOUT_DISPLAY_BRAND_PRESENTATION.bagPanel;
  const brand = new THREE.Mesh(new THREE.PlaneGeometry(bagPanel.width, bagPanel.height));
  brand.position.set(0, bagPanel.y, bagPanel.z);
  bag.add(brand);

  const pos = prepareRuntimeAsset((await loadGlb(new URL(
    '../assets/checkout/glb/pos_monitor.glb', import.meta.url,
  ))).scene);
  pos.name = 'production POS';
  pos.position.set(REGISTER.monitor.x, COUNTER_TOP, REGISTER.monitor.z);
  pos.rotation.y = REGISTER.monitor.ry;
  pos.scale.multiplyScalar(1.35);
  const posScreen = pos.getObjectByName('POS_Screen');
  assert.ok(posScreen, 'production POS owns the live-screen socket');
  const liveScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2125));
  liveScreen.position.z = 0.002;
  posScreen.add(liveScreen);

  const products = productIds.map((id, index) => {
    const { root } = buildCatalogProductProxy({ sku: skuById(id), merch });
    const pose = productPoses[index];
    root.name = id;
    root.position.set(pose.x, pose.y, pose.z);
    root.rotation.set(0, pose.ry || 0, 0);
    return root;
  });

  for (const subject of [bag, ...products, pos]) {
    const projected = visibleProjectionBounds(subject, camera);
    assert.ok(projected.minZ >= -1 && projected.maxZ <= 1,
      `${subject.name} is entirely between the camera clip planes`);
    assert.ok(projected.minX >= -0.92 && projected.maxX <= 0.92,
      `${subject.name} remains inside the horizontal safe area `
      + `(ndc ${projected.minX.toFixed(3)}..${projected.maxX.toFixed(3)})`);
    assert.ok(projected.minY >= -0.88 && projected.maxY <= 0.88,
      `${subject.name} remains inside the vertical safe area `
      + `(ndc ${projected.minY.toFixed(3)}..${projected.maxY.toFixed(3)})`);
  }
});

test('mixed working frame does not replace fulfillment, card, or cash views', () => {
  const posesStart = registerSource.indexOf('const POSES =');
  const posesEnd = registerSource.indexOf('const CAMERA_TWEEN_SECONDS', posesStart);
  const poses = registerSource.slice(posesStart, posesEnd);
  assert.match(poses, /overview: MIXED_POSE/);
  assert.match(poses, /scan: MIXED_POSE/);
  assert.match(poses, /cash: \{ pose: poseBetween\(/,
    'the drawer retains its dedicated top-down hardware view');

  const poseKey = functionBody(registerSource, 'poseKey');
  const fulfillment = poseKey.indexOf("return 'fulfillment'");
  const scan = poseKey.indexOf("return 'scan'");
  const card = poseKey.indexOf("workspace === 'card'");
  const cash = poseKey.indexOf("workspace === 'cash'");
  assert.ok(fulfillment >= 0 && fulfillment < scan && scan < card && card < cash,
    'fulfillment keeps highest precedence and payment workspaces remain state-specific');

  const dynamicPose = functionBody(registerSource, 'dynamicPose');
  assert.match(dynamicPose, /key === 'fulfillment'[\s\S]*?fulfillmentHandoffPose/);
  assert.match(dynamicPose, /key === 'cardTake'[\s\S]*?cardHandoffPose/);
  assert.match(dynamicPose, /key === 'card'[\s\S]*?cardTerminalPose/);
});

test('register prop choreography keeps world offsets and orientations in the desk frame', () => {
  const offsetHelper = functionBody(registerSource, 'frontDeskOffsetVector3');
  assert.match(offsetHelper, /frontDeskVector\(localX, localZ\)/,
    'root-space presentation offsets pass through the canonical desk vector');

  for (const name of [
    'restoreAcceptedTenderMeshes',
    'customerAnchor',
    'presentTender',
    'beginChangeHandoff',
    'layoutAcceptedTender',
    'printerSlotLocal',
    'updateCard',
  ]) {
    assert.match(functionBody(registerSource, name), /frontDeskOffsetVector3/,
      `${name} authors root-space deltas in the desk frame`);
  }
  const insertPath = functionBody(registerSource, 'refreshCardInsertPath');
  assert.match(insertPath, /cardSocketNode\.getWorldPosition/,
    'automatic insertion begins at the authored terminal socket');
  assert.match(insertPath, /root\.worldToLocal/,
    'the terminal socket is converted into the canonical register root');
  assert.doesNotMatch(registerSource, /refreshCardSwipePath/,
    'the removed swipe gesture cannot return through a stale helper');
  assert.match(registerSource, /slot\.add\(frontDeskOffsetVector3\(0, 0, 0\.022\)\)/,
    'receipt feed clearance follows local desk z');

  const bagProduct = functionBody(registerSource, 'bagProduct');
  assert.match(bagProduct,
    /frontDeskPoint\(-1\.02 \+ Math\.max\(0, oversizeCount - 1\) \* 0\.07, -0\.12\)/,
    'the oversize handoff is a desk-local point');
  assert.doesNotMatch(registerSource, /new THREE\.Vector3\(1\.88[^\n]*4\.08\)/,
    'the former world-axis oversize handoff is gone');

  const createCardMesh = functionBody(registerSource, 'createCardMesh');
  assert.match(createCardMesh, /base\.quaternion\.copy\(HELD_QUAT\)/,
    'a newly created card already faces the rotated cashier side');
  const resetBagAtCounter = functionBody(registerSource, 'resetBagAtCounter');
  assert.match(resetBagAtCounter, /frontDeskQuaternion\(CHECKOUT_BAG_PRESENTATION\.pitch\)/,
    'the counter bag resets in its desk-relative loading orientation');
  const updateDelivery = functionBody(registerSource, 'updateDelivery');
  assert.match(updateDelivery, /RECEIPT_PRINTER_QUATERNION/);
  assert.match(updateDelivery, /frontDeskQuaternion\(/,
    'receipt and bag delivery orientations rotate with the desk');
});

test('card recovery uses the declared cardReady vector and drawer travel stays staff-facing', () => {
  assert.doesNotMatch(registerSource, /\bcardTravel\b/, 'no unresolved cardTravel alias can ReferenceError');
  const createCardMesh = functionBody(registerSource, 'createCardMesh');
  assert.match(
    createCardMesh,
    /cardReady\.copy\(customerCardReadyPoint\(\)\)[\s\S]*?base\.position\.copy\(cardReady\)/,
    'every new or replacement card refreshes its live customer-hand vector before placement',
  );
  const recovery = functionBody(registerSource, 'reconcileCheckoutWatchdog');
  assert.match(recovery, /cardReady\.copy\(customerCardReadyPoint\(\)\)/);
  assert.match(recovery, /cardMesh\.position\.copy\(cardReady\)/);
  const updateCard = functionBody(registerSource, 'updateCard');
  assert.match(updateCard, /cardReady\.copy\(customerCardReadyPoint\(\)\)/,
    'presentation and eject recovery continue tracking the live customer grip');

  const buildDrawer = functionBody(registerSource, 'buildDrawer');
  assert.match(buildDrawer, /drawerGroup\.rotation\.y = COUNTER\.ry/);
  const updateDrawer = functionBody(registerSource, 'updateDrawer');
  assert.match(updateDrawer, /drawerMotionRoot\.position\.z = drawerAmount \* REGISTER\.drawer\.travel/);
  const closed = frontDeskLocalPoint(REGISTER.drawer.x, REGISTER.drawer.z);
  const opened = frontDeskLocalPoint(
    REGISTER.drawer.x + REGISTER.drawer.travelX,
    REGISTER.drawer.z + REGISTER.drawer.travelZ,
  );
  assert.ok(opened.z > closed.z, 'the rotated physical drawer opens toward local staff +z');
});

test('declined-card cash fallback presents tender, then one click accepts and deposits it', () => {
  const switchToCash = functionBody(registerSource, 'switchDeclinedCardToCash');
  const createTender = switchToCash.indexOf('createTender()');
  const presentationWorkspace = switchToCash.indexOf("setWorkspace('monitor')");
  assert.ok(createTender >= 0, 'switching to cash creates the customer tender');
  assert.ok(
    createTender < presentationWorkspace,
    'the shared monitor presentation workspace is selected only after tender exists',
  );
  assert.doesNotMatch(
    switchToCash,
    /setWorkspace\('cash'\)/,
    'switching payment cannot skip directly to the drawer camera',
  );

  const acceptCash = functionBody(registerSource, 'acceptPresentedCash');
  const acceptDomain = acceptCash.indexOf('acceptCash(tx)');
  const openDrawer = acceptCash.indexOf('openDrawer(tx)');
  const depositTender = acceptCash.indexOf('depositTendered(tx, drawer)');
  const drawerWorkspace = acceptCash.indexOf("setWorkspace('cash')");
  assert.ok(acceptDomain >= 0 && acceptDomain < openDrawer,
    'the domain accepts the customer tender before the drawer moves');
  assert.ok(openDrawer < depositTender && depositTender < drawerWorkspace,
    'one click opens the drawer, deposits the tender, then enters the change view');
  assert.match(acceptCash, /queueCashMotion/,
    'accepted bills and coins visibly file into their drawer wells');
  assert.doesNotMatch(acceptCash, /layoutAcceptedTender\(\)/,
    'the simplified flow does not require a second sorting gesture');
  assert.doesNotMatch(
    acceptCash,
    /setWorkspace\('monitor'\)/,
    'cash acceptance stays in the drawer workspace',
  );
});

test('the live reader has no state-driven lift or float mutation', () => {
  assert.doesNotMatch(registerSource, /\bTERM_FLOAT_LIFT\b/, 'reader lift constant must stay removed');
  assert.doesNotMatch(registerSource, /\btermFloat\b/, 'reader position must not depend on checkout state');
  assert.doesNotMatch(registerSource, /termObject\.position\.y\s*=/, 'reader y-position must not animate after attachment');
});

test('working views stay click-stable while Shift permits a bounded deliberate glance', () => {
  assert.equal(checkoutLookScale('scan', false), 0);
  assert.equal(checkoutLookScale('monitor', false), 0);
  assert.equal(checkoutLookScale('scan', true), 0.34);
  assert.equal(checkoutLookScale('monitor', true), 0.34);
  assert.equal(checkoutLookScale('card', false), 1);

  const updateLookTarget = functionBody(registerSource, 'updateLookTarget');
  assert.match(
    updateLookTarget,
    /checkoutLookScale\(workspace, !!event\.shiftKey\)/,
    'scan products and monitor buttons require the explicit glance modifier',
  );

  const updateCamera = functionBody(registerSource, 'updateCamera');
  assert.match(
    updateCamera,
    /workspace === 'scan' \|\| workspace === 'monitor'\) && !workingGlanceActive/,
    'working views remain fixed when the modifier is not held',
  );
});

test('receipt printing accepts only geometry whose long edge follows the feed axis', () => {
  assert.equal(
    receiptGeometryUsesFeedAxis({ x: 0.075, y: 0.185, z: 0.0356 }),
    true,
    'the rebuilt upright receipt uses its authored geometry',
  );
  assert.equal(
    receiptGeometryUsesFeedAxis({ x: 0.068, y: 0.0366, z: 0.1515 }),
    false,
    'the legacy Z-long receipt falls back to the printable owned strip',
  );
  assert.equal(receiptGeometryUsesFeedAxis({ x: 0.075, y: Number.NaN, z: 0.03 }), false);
});

test('fulfilment frames the bag, paid goods, right-side printer, and customer palms from the staff side', () => {
  const pose = fulfillmentHandoffPose(
    CUSTOMER, REGISTER.printer, COUNTER_TOP, REGISTER.bag, REGISTER.scannedStaging,
  );
  const eye = frontDeskLocalPoint(pose.eye.x, pose.eye.z);
  const look = frontDeskLocalPoint(pose.look.x, pose.look.z);
  const customer = frontDeskLocalPoint(CUSTOMER.x, CUSTOMER.z);
  const printer = frontDeskLocalPoint(REGISTER.printer.x, REGISTER.printer.z);
  const bag = frontDeskLocalPoint(REGISTER.bag.x, REGISTER.bag.z);
  assert.ok(eye.z > 1.3 && eye.z < 1.55,
    'the fulfilment eye stays behind the counter without pulling back across the room');
  assert.ok(look.z < eye.z, 'the view looks across the counter');
  assert.ok(look.x > Math.min(customer.x, printer.x, bag.x)
    && look.x < Math.max(customer.x, printer.x, bag.x),
  'the aim sits inside the full bag/customer/printer span in desk space');
  assert.ok(pose.look.y > COUNTER_TOP && pose.look.y < COUNTER_TOP + 0.30,
    'the aim follows the receipt and handoff height');
  assert.ok(pose.fov >= 51 && pose.fov <= 53,
    'the bag, printer, and both customer grips fit a close working frame');
});

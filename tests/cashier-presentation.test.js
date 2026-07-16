import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CASHIER_CAMERA_FOV,
  CASHIER_CAMERA_VIEW,
  cashierCameraView,
  cashierHandPoseForFrame,
  cashierItemPickSize,
} from '../src/render3d/clubhouse/cashierPresentation.js';
import { CASHIER_POSES, makeCashierHands } from '../src/render3d/clubhouse/cashierHands.js';

test('scan focus is limited to a physically held product in ProductHeld or ProductScanning', () => {
  for (const flowState of ['ProductHeld', 'ProductScanning']) {
    assert.equal(cashierCameraView({ active: true, flowState, grabbedKind: 'item' }), CASHIER_CAMERA_VIEW.SCAN);
  }
  assert.equal(cashierCameraView({ active: true, flowState: 'ProductScanned', grabbedKind: 'item' }), CASHIER_CAMERA_VIEW.WIDE);
  assert.equal(cashierCameraView({ active: true, flowState: 'ProductHeld', grabbedKind: null }), CASHIER_CAMERA_VIEW.WIDE);
  assert.equal(cashierCameraView({ active: false, flowState: 'ProductHeld', grabbedKind: 'item' }), CASHIER_CAMERA_VIEW.INACTIVE);
  assert.ok(CASHIER_CAMERA_FOV.SCAN >= 55 && CASHIER_CAMERA_FOV.SCAN <= 70);
  assert.ok(CASHIER_CAMERA_FOV.WIDE >= 55 && CASHIER_CAMERA_FOV.WIDE <= 70);
  assert.ok(CASHIER_CAMERA_FOV.SCAN < CASHIER_CAMERA_FOV.WIDE, 'scan focus narrows before restoring wide framing');
});

test('physical product verbs select distinct reach, grip, rotate, scan, stage, and bag poses', () => {
  assert.equal(cashierHandPoseForFrame({ active: true, hoveredItem: true }), 'reach');
  assert.equal(cashierHandPoseForFrame({ active: true, grabbedKind: 'item', itemPickSize: 'small' }), 'pick-small');
  assert.equal(cashierHandPoseForFrame({ active: true, grabbedKind: 'item', itemPickSize: 'medium' }), 'pick-medium');
  assert.equal(cashierHandPoseForFrame({ active: true, transientPose: 'rotate', grabbedKind: 'item' }), 'rotate');
  assert.equal(cashierHandPoseForFrame({ active: true, grabbedKind: 'item', flowState: 'ProductScanning' }), 'scan');
  assert.equal(cashierHandPoseForFrame({ active: true, grabbedKind: 'item', itemScanned: true }), 'place-item');
  assert.equal(cashierHandPoseForFrame({ active: true, grabbedKind: 'item', txStage: 'bagging' }), 'bag-item');
});

test('cash verbs distinguish acceptance, deposit, selection, holding, and giving for bills and coins', () => {
  assert.equal(cashierHandPoseForFrame({
    active: true, grabbedKind: 'money', grabbedFrom: 'tender', grabbedIsBill: true, drawerOpen: false,
  }), 'accept-bill');
  assert.equal(cashierHandPoseForFrame({
    active: true, grabbedKind: 'money', grabbedFrom: 'tender', grabbedIsBill: false, drawerOpen: false,
  }), 'accept-coin');
  assert.equal(cashierHandPoseForFrame({
    active: true, grabbedKind: 'money', grabbedFrom: 'tender', grabbedIsBill: true, drawerOpen: true,
  }), 'deposit-bill');
  assert.equal(cashierHandPoseForFrame({
    active: true, grabbedKind: 'money', grabbedFrom: 'tender', grabbedIsBill: false, drawerOpen: true,
  }), 'deposit-coin');
  assert.equal(cashierHandPoseForFrame({ active: true, transientPose: 'select-change' }), 'select-change');
  assert.equal(cashierHandPoseForFrame({ active: true, hasSelectedChange: true }), 'hold-change');
  assert.equal(cashierHandPoseForFrame({ active: true, changeHandoff: true }), 'give-change');
});

test('receipt, bag, and card verbs remain distinct and every routed name exists in the rig', () => {
  const routed = [
    cashierHandPoseForFrame({ active: true, grabbedKind: 'receipt', receiptTaken: false, txStage: 'receipt' }),
    cashierHandPoseForFrame({ active: true, grabbedKind: 'receipt', receiptTaken: true, txStage: 'bagging' }),
    cashierHandPoseForFrame({ active: true, txStage: 'bagging', bagReady: false }),
    cashierHandPoseForFrame({ active: true, grabbedKind: 'bag' }),
    cashierHandPoseForFrame({ active: true, cardVisible: true, cardMoving: false }),
    cashierHandPoseForFrame({ active: true, cardVisible: true, cardMoving: true }),
  ];
  assert.deepEqual(routed, [
    'collect-receipt', 'add-receipt', 'open-bag', 'hand-bag', 'hold-card', 'swipe-card',
  ]);
  for (const pose of routed) assert.ok(CASHIER_POSES[pose], `${pose} is implemented by the hand rig`);
});

test('catalog weight and authored grip metadata choose small versus supported medium pickup', () => {
  assert.equal(cashierItemPickSize({ weightLb: 0.2 }), 'small');
  assert.equal(cashierItemPickSize({ weightLb: 1.4 }), 'medium');
  assert.equal(cashierItemPickSize({ weightLb: 3, gripMode: 'small' }), 'small');
  assert.equal(cashierItemPickSize({ weightLb: 0.1, gripMode: 'medium' }), 'medium');
  assert.equal(cashierItemPickSize({ weightLb: 0.2, gripMode: 'two-hand' }), 'medium');
  assert.equal(cashierItemPickSize({ weightLb: 0.2, gripMode: 'oversize' }), 'medium');
});

test('active cashier mode shows two connected idle arms without interaction targets', () => {
  const interior = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 100);
  camera.position.set(2.78, 1.68, 5.24);
  camera.lookAt(2.52, 1.04, 4.02);
  camera.updateMatrixWorld(true);
  interior.updateMatrixWorld(true);

  const rig = makeCashierHands(interior);
  rig.update(1, camera, { visible: true, pose: 'idle' });

  assert.equal(rig.root.visible, true);
  assert.equal(rig.root.children.length, 2);
  assert.equal(rig.root.children[0].visible, true);
  assert.equal(rig.root.children[1].visible, true);
  const rightHand = rig.root.children[0].children.at(-1);
  const leftHand = rig.root.children[1].children.at(-1);
  assert.notDeepEqual(rightHand.position.toArray(), leftHand.position.toArray());

  // Idle wrists remain visible in separate lower-frame corners. This guards the
  // camera-safe presentation origin: the previous fixed near-camera shoulder put
  // both idle hands below the frustum and stretched targeted sleeves through it.
  const rightNdc = rightHand.position.clone().project(camera);
  const leftNdc = leftHand.position.clone().project(camera);
  assert.ok(rightNdc.x > 0.25 && rightNdc.x < 0.75);
  assert.ok(leftNdc.x < -0.25 && leftNdc.x > -0.75);
  assert.ok(rightNdc.y > -0.95 && rightNdc.y < -0.55);
  assert.ok(leftNdc.y > -0.95 && leftNdc.y < -0.55);

  const [forearm, upperArm, sleeve, , cuffEdge] = rig.root.children[0].children;
  assert.ok(forearm.geometry.parameters.radiusBottom > forearm.geometry.parameters.radiusTop,
    'forearm tapers from elbow to wrist');
  assert.ok(upperArm.geometry.parameters.radiusBottom > upperArm.geometry.parameters.radiusTop,
    'upper arm has a subtler natural taper');
  assert.ok(sleeve.geometry.parameters.radiusTop > upperArm.geometry.parameters.radiusBottom,
    'polo sleeve overlaps the skin transition instead of pinching inward');
  assert.equal(cuffEdge.material.color.getHex(), 0x78947c);
  assert.equal(rightHand.children[0].geometry.type, 'SphereGeometry', 'palm uses a rounded silhouette');

  rig.hideImmediately();
  assert.equal(rig.root.visible, false);
  assert.equal(rig.root.children[0].visible, false);
  assert.equal(rig.root.children[1].visible, false);
});

test('depth-aware arm origins preserve distant bag grips without stretched sleeve tubes', () => {
  const interior = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 100);
  camera.position.set(1.72, 1.58, 5.18);
  camera.lookAt(1.78, 1.22, 3.63);
  camera.updateMatrixWorld(true);
  interior.updateMatrixWorld(true);

  const rightGrip = new THREE.Vector3(1.91, 1.43, 3.70);
  const leftGrip = new THREE.Vector3(1.65, 1.43, 3.70);
  const rig = makeCashierHands(interior);
  rig.update(1, camera, {
    visible: true,
    pose: 'hand-bag',
    rightTarget: rightGrip,
    leftTarget: leftGrip,
  });

  const rightArm = rig.root.children[0];
  const leftArm = rig.root.children[1];
  assert.ok(rightArm.children.at(-1).position.distanceTo(rightGrip) < 0.005);
  assert.ok(leftArm.children.at(-1).position.distanceTo(leftGrip) < 0.005);
  assert.ok(rightArm.children[2].scale.y <= 0.220001, 'right short sleeve is capped at handoff depth');
  assert.ok(leftArm.children[2].scale.y <= 0.220001, 'left short sleeve is capped at handoff depth');
  assert.ok(Math.abs(rightArm.children[4].scale.y - 0.032) < 1e-6, 'rolled cuff keeps a stable width');
});

test('a one-handed physical verb hides the untargeted offhand instead of leaving a cuff stump', () => {
  const interior = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 100);
  camera.position.set(2.78, 1.68, 5.24);
  camera.lookAt(2.52, 1.04, 4.02);
  camera.updateMatrixWorld(true);
  interior.updateMatrixWorld(true);

  const rig = makeCashierHands(interior);
  rig.update(1, camera, {
    visible: true,
    pose: 'hold-card',
    leftTarget: new THREE.Vector3(2.20, 1.10, 4.10),
  });

  assert.equal(rig.root.children[0].visible, false, 'untargeted right arm is fully hidden');
  assert.equal(rig.root.children[1].visible, true, 'targeted left arm remains visible');
});

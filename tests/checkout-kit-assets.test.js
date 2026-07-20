// Three.js load validation for the Prime Fairways checkout asset kit
// (assets/checkout/glb).  Uses the game's real GLTFLoader, mirroring
// tests/catalog-product-visual.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { slotsFor } from '../src/data/fixtureSlots.js';

const KIT = [
  'checkout_counter', 'pos_monitor', 'cash_drawer', 'payment_terminal',
  'barcode_scanner', 'receipt_printer', 'shopping_bag', 'payment_card',
  'cash_bill_1', 'cash_bill_5', 'cash_bill_10', 'cash_bill_20', 'cash_bill_50',
  'cash_coin_01', 'cash_coin_05', 'cash_coin_05_sheet01', 'cash_coin_10', 'cash_coin_20', 'cash_coin_50',
  'scannable_product_box', 'customer_display', 'loose_receipt', 'cash_handoff_stack',
  'apparel_wall',
  // Asset Sheet 03: the retail fixture family
  'apparel_wall_display', 'hat_wall', 'accessory_slatwall', 'club_rack',
  'putter_rack', 'bag_display', 'shoe_wall', 'ball_shelf', 'snack_shelf',
  'rangefinder_display',
  // Asset Sheet 04: the furniture family
  'merch_table', 'retail_gondola', 'apparel_table', 'stock_shelving',
  'storage_tote_olive', 'storage_tote_slate', 'storage_tote_charcoal',
  'storage_tote_stone', 'lounge_armchair', 'lounge_coffee_table',
  'lounge_side_table', 'office_desk', 'office_chair', 'filing_cabinet',
];

function makeLoader() {
  // node has no DOM image decode; stub texture creation only (geometry, nodes,
  // materials and animations still go through the real game loader code)
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'node-texture-stub', loadTexture: async () => new THREE.Texture() }));
  return loader;
}

async function loadKit() {
  const out = new Map();
  for (const name of KIT) {
    const bytes = await readFile(new URL(`../assets/checkout/glb/${name}.glb`, import.meta.url));
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const gltf = await new Promise((resolve, reject) => makeLoader().parse(data, '', resolve, reject));
    out.set(name, gltf);
  }
  return out;
}

const kitPromise = loadKit();

function names(root) {
  const set = new Set();
  root.traverse((o) => set.add(o.name));
  return set;
}

function sizeOf(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh || o.name.startsWith('COL_')) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return box.getSize(new THREE.Vector3());
}

test('every kit GLB loads in three.js without errors', async () => {
  const kit = await kitPromise;
  assert.equal(kit.size, KIT.length);
  for (const [name, gltf] of kit) {
    assert.ok(gltf.scene, `${name} has a scene`);
  }
});

test('every authored checkout GLB is byte-identical to the runtime mirror', async () => {
  for (const name of KIT) {
    const [authored, runtime] = await Promise.all([
      readFile(new URL(`../assets/checkout/glb/${name}.glb`, import.meta.url)),
      readFile(new URL(`../vendor/models/checkout/${name}.glb`, import.meta.url)),
    ]);
    assert.ok(authored.equals(runtime), `${name} runtime mirror is stale`);
  }
});

test('counter exposes every placement mount and correct scale', async () => {
  const kit = await kitPromise;
  const scene = (await kit.get('checkout_counter')).scene;
  const n = names(scene);
  for (const m of ['POS_MOUNT', 'CASH_DRAWER_MOUNT', 'CARD_TERMINAL_MOUNT', 'BARCODE_SCANNER_MOUNT',
    'RECEIPT_PRINTER_MOUNT', 'CUSTOMER_DISPLAY_MOUNT', 'BAG_PLACEMENT', 'UNSCANNED_ITEM_AREA',
    'SCANNED_ITEM_AREA', 'COL_CheckoutCounter']) {
    assert.ok(n.has(m), `counter missing ${m}`);
  }
  const s = sizeOf(scene);
  assert.ok(s.x > 2.4 && s.x < 2.8, `counter width ${s.x}`);
  assert.ok(s.y > 0.9 && s.y < 1.05, `counter height (Y-up) ${s.y}`);
});

test('pos monitor has a separate dynamic screen mesh', async () => {
  const kit = await kitPromise;
  const scene = (await kit.get('pos_monitor')).scene;
  let screen = null;
  scene.traverse((o) => { if (o.name === 'POS_Screen') screen = o; });
  assert.ok(screen?.isMesh, 'POS_Screen mesh exists');
  assert.ok(screen.material, 'screen has a material');
  screen.geometry.computeBoundingBox();
  const screenSize = screen.geometry.boundingBox.getSize(new THREE.Vector3());
  assert.ok(Math.abs(screenSize.x - 0.348) < 0.006, `screen width ${screenSize.x}`);
  assert.ok(Math.abs(screenSize.y - 0.2185) < 0.006, `screen height ${screenSize.y}`);
  // the game can swap in a CanvasTexture material
  screen.material = new THREE.MeshBasicMaterial();
  assert.equal(screen.material.type, 'MeshBasicMaterial');
  for (const part of ['POS_Body', 'POS_Stand', 'POS_Base']) {
    assert.ok(names(scene).has(part), `missing ${part}`);
  }
});

test('cash drawer has open/close clips + all money sockets', async () => {
  const kit = await kitPromise;
  const gltf = await kit.get('cash_drawer');
  const clips = gltf.animations.map((a) => a.name).sort();
  assert.deepEqual(clips, ['CashDrawer_Close', 'CashDrawer_Open']);
  const n = names(gltf.scene);
  for (const b of ['1', '5', '10', '20', '50']) assert.ok(n.has(`BILL_${b}_SOCKET`), `BILL_${b}_SOCKET`);
  for (const c of ['01', '05', '10', '20', '50']) assert.ok(n.has(`COIN_${c}_SOCKET`), `COIN_${c}_SOCKET`);
  for (const part of ['CashDrawer_Housing', 'CashDrawer_Tray', 'CashDrawer_Insert', 'CashDrawer_Lock']) {
    assert.ok(n.has(part), part);
  }
  // clips target the tray
  const open = gltf.animations.find((a) => a.name === 'CashDrawer_Open');
  assert.ok(open.tracks.some((t) => t.name.includes('CashDrawer_Tray')), 'open animates tray');
});

test('every drawer socket carries its authored placement contract', async () => {
  const kit = await kitPromise;
  const scene = (await kit.get('cash_drawer')).scene;
  scene.updateMatrixWorld(true);
  const socket = (name) => {
    let found = null;
    scene.traverse((o) => { if (o.name === name) found = o; });
    return found;
  };
  for (const b of ['1', '5', '10', '20', '50']) {
    const s = socket(`BILL_${b}_SOCKET`);
    const u = s.userData;
    assert.equal(u.socket, 'bill', `bill ${b} socket kind`);
    assert.equal(u.denomination, b);
    assert.ok(u.well_w > 0.04 && u.well_w < 0.09, `bill ${b} well_w ${u.well_w}`);
    assert.ok(u.well_d > 0.15 && u.well_d < 0.26, `bill ${b} well_d ${u.well_d}`);
    assert.ok(u.max_pieces >= 8, `bill ${b} max_pieces`);
    assert.ok(u.spacing_m > 0.0005 && u.spacing_m < 0.004, `bill ${b} spacing`);
    assert.ok(u.hinge_drop_m > 0.015 && u.hinge_drop_m < 0.08, `bill ${b} hinge drop`);
    // a full authored stack must still fit BELOW the clip hinge
    assert.ok(u.max_pieces * u.spacing_m + 0.0015 < u.hinge_drop_m,
      `bill ${b}: max stack ${u.max_pieces * u.spacing_m} vs hinge ${u.hinge_drop_m}`);
    // the articulated clip the socket names must exist and rest TILTED (empty pose)
    const clip = socket(u.clip);
    assert.ok(clip, `bill ${b} clip object ${u.clip}`);
    assert.ok(Math.abs(clip.rotation.x) > 0.1, `bill ${b} clip rests tilted, rx=${clip.rotation.x}`);
  }
  for (const c of ['01', '05', '10', '20', '50']) {
    const s = socket(`COIN_${c}_SOCKET`);
    const u = s.userData;
    assert.equal(u.socket, 'coin', `coin ${c} socket kind`);
    assert.equal(u.denomination, c);
    assert.ok(u.well_w > 0.04 && u.well_w < 0.09, `coin ${c} well_w ${u.well_w}`);
    assert.ok(u.well_d > 0.10 && u.well_d < 0.20, `coin ${c} well_d ${u.well_d}`);
    assert.ok(u.max_pieces >= 20, `coin ${c} max_pieces`);
    assert.ok(u.pile_h_m > 0.001 && u.pile_h_m < 0.008, `coin ${c} pile step`);
  }
  // sockets sit ON the insert floor, all at one height, all inside the tray
  const heights = new Set();
  for (const name of ['BILL_1_SOCKET', 'BILL_50_SOCKET', 'COIN_01_SOCKET', 'COIN_50_SOCKET']) {
    const s = socket(name);
    const w = new THREE.Vector3();
    s.getWorldPosition(w);
    heights.add(Math.round(w.y * 1000));
  }
  assert.ok(heights.size <= 2, `socket heights should be flat-ish: ${[...heights]}`);
});

test('payment terminal exposes every key + card socket; card fits the slot', async () => {
  const kit = await kitPromise;
  const term = (await kit.get('payment_terminal')).scene;
  const n = names(term);
  for (let d = 0; d <= 9; d++) assert.ok(n.has(`Terminal_Key_${d}`), `Terminal_Key_${d}`);
  for (const part of ['Terminal_Body', 'Terminal_Screen', 'Terminal_Keypad', 'Terminal_CancelButton',
    'Terminal_BackButton', 'Terminal_ConfirmButton', 'Terminal_ChipSlot', 'CARD_INSERT_SOCKET',
    'Terminal_NFCMark', 'NFC_TAP_SOCKET']) {
    assert.ok(n.has(part), part);
  }
  // card short edge (54 mm) must fit the 58 mm slot gap
  const card = (await kit.get('payment_card')).scene;
  const cs = sizeOf(card);
  const shortEdge = Math.min(cs.x, cs.z);
  assert.ok(shortEdge < 0.058, `card short edge ${shortEdge} fits slot`);
});

test('scanner + printer expose interaction points and the print clip', async () => {
  const kit = await kitPromise;
  const scannerScene = (await kit.get('barcode_scanner')).scene;
  const scn = names(scannerScene);
  for (const part of ['Scanner_Base', 'Scanner_Stand', 'Scanner_Head', 'Scanner_Window',
    'Scanner_LED', 'Scanner_CashierLED', 'SCAN_RAY_ORIGIN']) {
    assert.ok(scn.has(part), part);
  }
  scannerScene.updateMatrixWorld(true);
  const windowDirection = new THREE.Vector3(0, 0, 1).applyQuaternion(
    scannerScene.getObjectByName('Scanner_Window').getWorldQuaternion(new THREE.Quaternion()),
  );
  const rayDirection = new THREE.Vector3(0, 0, 1).applyQuaternion(
    scannerScene.getObjectByName('SCAN_RAY_ORIGIN').getWorldQuaternion(new THREE.Quaternion()),
  );
  assert.ok(windowDirection.dot(rayDirection) > 0.999,
    `scanner ray must leave through its visible window, dot=${windowDirection.dot(rayDirection)}`);
  const printer = await kit.get('receipt_printer');
  assert.deepEqual(printer.animations.map((a) => a.name), ['Receipt_Print']);
  const pn = names(printer.scene);
  for (const part of ['Printer_Body', 'Printer_Cover', 'Printer_OutputSlot', 'Printer_Button', 'Printer_LED',
    'PaperRollPivot', 'Receipt_Paper', 'RECEIPT_OUTPUT_SOCKET', 'RECEIPT_TEAR_SOCKET',
    'RECEIPT_PICKUP_SOCKET', 'ANCHOR_ReceiptFeed', 'ANCHOR_Tear', 'ANCHOR_ReceiptPickup']) {
    assert.ok(pn.has(part), part);
  }
});

test('bag, product box and helpers expose their sockets', async () => {
  const kit = await kitPromise;
  const bag = names((await kit.get('shopping_bag')).scene);
  for (const part of ['Bag_Body', 'Bag_Handle_Left', 'Bag_Handle_Right', 'BAG_PICKUP_SOCKET',
    'ANCHOR_BagDrop', 'ANCHOR_BagContents', 'ANCHOR_BagHandoff', 'ANCHOR_ReceiptPocket',
    'ANCHOR_BagHandleFront', 'ANCHOR_BagHandleBack',
    'BAG_ITEM_SOCKET_01', 'BAG_ITEM_SOCKET_02', 'BAG_ITEM_SOCKET_03', 'BAG_ITEM_SOCKET_04']) {
    assert.ok(bag.has(part), part);
  }
  const box = names((await kit.get('scannable_product_box')).scene);
  for (const part of ['ProductBox_Body', 'PRODUCT_BARCODE', 'PRODUCT_GRAB_SOCKET', 'COL_ProductBox']) {
    assert.ok(box.has(part), part);
  }
  const disp = names((await kit.get('customer_display')).scene);
  assert.ok(disp.has('CustomerDisplay_Screen'), 'CustomerDisplay_Screen');
  const stack = names((await kit.get('cash_handoff_stack')).scene);
  for (let i = 1; i <= 5; i++) assert.ok(stack.has(`STACK_BILL_SOCKET_0${i}`), `bill socket ${i}`);
});

test('loose receipt uses the authored 75 x 185 mm bottom-anchored strip', async () => {
  const kit = await kitPromise;
  const scene = (await kit.get('loose_receipt')).scene;
  const n = names(scene);
  for (const part of ['Receipt_Strip', 'RECEIPT_FEED_SOCKET', 'RECEIPT_HANDOFF_SOCKET']) {
    assert.ok(n.has(part), part);
  }
  const size = sizeOf(scene);
  assert.ok(Math.abs(size.x - 0.075) < 0.004, `receipt width ${size.x}`);
  assert.ok(Math.abs(size.y - 0.185) < 0.005, `receipt length ${size.y}`);
});

test('denominations are correctly sized, centred and lightweight', async () => {
  const kit = await kitPromise;
  // Sheet-specific note footprints and the Sheet-02 coin diameter ladder.
  const BILL_LEN = { 1: 0.122, 5: 0.132, 10: 0.142, 20: 0.156, 50: 0.156 };
  const COIN_DIA = { '01': 0.018, '05': 0.021, 10: 0.024, 20: 0.026, 50: 0.030 };
  const COIN_TRIS = { '01': 188, '05': 220, 10: 252, 20: 284, 50: 300 };
  for (const d of ['1', '5', '10', '20', '50']) {
    const scene = (await kit.get(`cash_bill_${d}`)).scene;
    const s = sizeOf(scene);
    assert.ok(Math.abs(s.x - BILL_LEN[d]) < 0.005, `bill ${d} length ${s.x}`);
    let tris = 0;
    scene.traverse((o) => { if (o.isMesh) tris += o.geometry.index.count / 3; });
    assert.ok(tris < 500, `bill ${d} tris ${tris}`);
  }
  for (const c of ['01', '05', '10', '20', '50']) {
    const scene = (await kit.get(`cash_coin_${c}`)).scene;
    const s = sizeOf(scene);
    assert.ok(Math.abs(s.x - COIN_DIA[c]) < 0.002, `coin ${c} diameter ${s.x}`);
    const visible = [];
    const collisions = [];
    scene.traverse((o) => {
      if (o.name.startsWith('COL_')) collisions.push(o.name);
      if (o.isMesh && !o.name.startsWith('COL_')) visible.push(o);
    });
    assert.deepEqual(collisions, [], `coin ${c} has no cloned collision proxy`);
    assert.equal(visible.length, 1, `coin ${c} has one visible mesh`);
    assert.equal(visible[0].name, 'Coin_Body');
    assert.equal(visible[0].geometry.index.count / 3, COIN_TRIS[c], `coin ${c} exact triangles`);
    assert.equal(visible[0].material.side, THREE.FrontSide, `coin ${c} culls backfaces`);
    const root = scene.getObjectByName(`cash_coin_${c}`);
    assert.equal(root.userData.asset_id, `cash_coin_${c}`);
    assert.equal(root.userData.denomination_cents, Number(c));
    assert.match(root.userData.front, /obverse/);
    assert.match(root.userData.reverse, /-Z/);
  }
  const sheet01Five = (await kit.get('cash_coin_05_sheet01')).scene;
  const sheet01Size = sizeOf(sheet01Five);
  assert.ok(Math.abs(sheet01Size.x - 0.024) < 0.002,
    `Sheet-01 five-unit coin diameter ${sheet01Size.x}`);
  assert.ok(Math.abs(sheet01Size.x - sizeOf((await kit.get('cash_coin_05')).scene).x) > 0.002,
    'Sheet-01 and Sheet-02 five-unit coins remain physically distinct');
  let sheet01Tris = 0;
  sheet01Five.traverse((o) => { if (o.isMesh) sheet01Tris += o.geometry.index.count / 3; });
  assert.ok(sheet01Tris < 1000, `Sheet-01 five-unit coin tris ${sheet01Tris}`);
});

test('Sheet-01 checkout assets stay within the reference triangle budgets', async () => {
  const kit = await kitPromise;
  const budgets = {
    checkout_counter: 4800,
    pos_monitor: 3100,
    payment_terminal: 2900,
    cash_drawer: 6200,
    receipt_printer: 2300,
    shopping_bag: 1900,
    payment_card: 300,
    loose_receipt: 200,
    cash_bill_20: 80,
    cash_coin_05_sheet01: 250,
  };
  for (const [name, budget] of Object.entries(budgets)) {
    let triangles = 0;
    (await kit.get(name)).scene.traverse((object) => {
      if (!object.isMesh || object.name.startsWith('COL_')) return;
      triangles += object.geometry.index
        ? object.geometry.index.count / 3
        : object.geometry.attributes.position.count / 3;
    });
    assert.ok(triangles <= budget, `${name} triangles ${triangles} exceed ${budget}`);
  }
});

test('apparel wall exposes its display parts and placement sockets', async () => {
  const kit = await kitPromise;
  const scene = (await kit.get('apparel_wall')).scene;
  const n = names(scene);
  for (const part of ['Slatwall', 'Back_Panel', 'Header', 'Header_Sign', 'Header_Lettering',
    'Hanging_Rod', 'Folded_Shelf_Lower', 'Folded_Shelf_Upper',
    'Lower_Frame_Side_L', 'Lower_Frame_Side_R', 'COL_ApparelWall']) {
    assert.ok(n.has(part), `apparel wall missing ${part}`);
  }
  const expectedSockets = [
    ...Array.from({ length: 4 }, (_, i) => `APPAREL_HANGER_SLOT_0${i + 1}`),
    ...Array.from({ length: 4 }, (_, i) => `APPAREL_FOLD_SLOT_0${i + 1}`),
  ];
  const sockets = [];
  scene.traverse((o) => { if (/^APPAREL_(HANGER|FOLD)_SLOT_/.test(o.name)) sockets.push(o); });
  assert.deepEqual(sockets.map((o) => o.name).sort(), expectedSockets.sort(), 'exactly four hanging + four folded sockets');
  for (const socket of sockets) {
    assert.equal(socket.isMesh, undefined, `${socket.name} is transform-only`);
    assert.ok(['hanger', 'folded'].includes(socket.userData.socket), `${socket.name} socket type`);
    assert.ok(socket.userData.order >= 1 && socket.userData.order <= 4, `${socket.name} order`);
  }
  assert.ok(![...n].some((name) => /^APPAREL_(HOOK|SHELF)_SLOT_/.test(name)), 'no unused apparel sockets');
  assert.ok(![...n].some((name) => /^Cabinet_/.test(name)), 'lower stock area stays open');
  assert.ok(![...n].some((name) => /(Jacket|Polo|Shirt|Garment)/.test(name)), 'inventory garments are not baked into the fixture');

  const root = scene.getObjectByName('apparel_wall');
  assert.deepEqual(root.userData.target_dimensions_m, [1.2, 0.45, 2.2]);
  // single-module envelope: 1.20 wide, 2.20 tall (Y-up after import), 0.45 deep
  const s = sizeOf(scene);
  assert.ok(Math.abs(s.x - 1.20) < 0.05, `width ${s.x}`);
  assert.ok(Math.abs(s.y - 2.20) < 0.05, `height ${s.y}`);
  assert.ok(Math.abs(s.z - 0.45) < 0.05, `depth ${s.z}`);

  scene.updateMatrixWorld(true);
  const logical = slotsFor('jacket2');
  for (let i = 0; i < logical.length; i++) {
    const point = scene.getObjectByName(logical[i].socketName).getWorldPosition(new THREE.Vector3());
    assert.ok(point.distanceTo(new THREE.Vector3(logical[i].x, logical[i].y, logical[i].z)) < 1e-5,
      `${logical[i].socketName} matches its immediate-load fallback`);
  }

  const collisions = [];
  scene.traverse((o) => { if (o.name === 'COL_ApparelWall') collisions.push(o); });
  assert.equal(collisions.length, 1, 'one apparel collision proxy');
  const collision = collisions[0];
  collision.geometry.computeBoundingBox();
  const collisionBox = collision.geometry.boundingBox.clone().applyMatrix4(collision.matrixWorld);
  const collisionSize = collisionBox.getSize(new THREE.Vector3());
  const collisionCenter = collisionBox.getCenter(new THREE.Vector3());
  assert.ok(collisionSize.distanceTo(new THREE.Vector3(1.2, 2.2, 0.45)) < 1e-5, `collision size ${collisionSize.toArray()}`);
  assert.ok(collisionCenter.distanceTo(new THREE.Vector3(0, 1.1, 0)) < 1e-5, `collision center ${collisionCenter.toArray()}`);

  let tris = 0;
  scene.traverse((o) => {
    if (o.isMesh && !o.name.startsWith('COL_')) {
      tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
    }
  });
  assert.ok(tris <= 2800, `apparel wall tris ${tris}`);   // the Sheet-02 budget
});

test('the Sheet-03 fixtures expose their parts, sockets, envelopes and budgets', async () => {
  const kit = await kitPromise;
  // { asset: [ [required node names...], [w, h] envelope (x/z ±0.06), tri cap ] }
  const FIXTURES = {
    apparel_wall_display: [['Slatwall', 'Back_Panel', 'Header_Sign', 'Base_Shelf',
      'Faceout_Arm_01', 'Faceout_Arm_08', 'DISPLAY_ARM_SLOT_08', 'DISPLAY_BASE_SLOT_04',
      'COL_ApparelWallDisplay'], [1.20, 2.20], 2400 * 1.25],
    hat_wall: [['Slatwall', 'Back_Panel', 'Header_Sign', 'Peg_Arm_01', 'Peg_Arm_16',
      'HAT_PEG_SLOT_01', 'HAT_PEG_SLOT_16', 'COL_HatWall'], [1.00, 2.20], 1600 * 1.25],
    accessory_slatwall: [['Slatwall', 'Shelf_01', 'Shelf_03', 'Hook_Short_Plate_01',
      'Hook_Long_Plate_02', 'Hook_Double_Plate_02', 'ACC_SHELF_SLOT_03', 'ACC_HOOK_SLOT_06',
      'ACC_PRODUCT_SLOT_01', 'ACC_PRODUCT_SLOT_12',
      'COL_AccessorySlatwall'], [1.00, 2.00], 1700 * 1.25],
    club_rack: [['Base', 'Head_Rail', 'Trough_Floor', 'Trough_Felt', 'Trough_Lip', 'End_Cap_L',
      'CLUB_SLOT_01', 'CLUB_SLOT_10', 'COL_ClubRack'], [1.20, 1.10], 2200 * 1.25],
    putter_rack: [['Base', 'Base_Felt', 'Grip_Rail', 'Groove_Divider_01', 'Groove_Divider_09',
      'PUTTER_SLOT_01', 'PUTTER_SLOT_10', 'COL_PutterRack'], [1.00, 1.00], 1800 * 1.25],
    // The deck is six real planks over a welded perimeter channel on four
    // legs, and every bay carries a cradle - assert that construction rather
    // than the single 'Deck' slab it replaced.
    bag_display: [['Deck_Plank_01', 'Deck_Plank_06', 'Frame_Rail_Front', 'Frame_Rail_Back',
      'Leg_LF', 'Leg_RB', 'Foot_LF', 'Lean_Rail', 'Mid_Rail', 'Rail_Post_L',
      'Cradle_Arm_01_L', 'Cradle_Saddle_05',
      'BAG_SLOT_01', 'BAG_SLOT_05', 'COL_BagDisplay'], [1.60, 1.10, 0.40], 2600 * 1.25],
    shoe_wall: [['Slatwall', 'Display_Board_01', 'Display_Board_03', 'Box_Shelf',
      'SHOE_SLOT_01', 'SHOE_SLOT_06', 'SHOEBOX_SLOT_03',
      'COL_ShoeWall'], [1.20, 2.00], 2600 * 1.25],
    ball_shelf: [['Side_L', 'Board_01', 'Board_03', 'Board_Lip_01', 'BALL_SLOT_01',
      'BALL_SLOT_15', 'COL_BallShelf'], [1.00, 1.22], 1500 * 1.25],
    snack_shelf: [['Frame_Post_LF', 'Header_Fascia', 'Shelf_01', 'Shelf_04', 'SNACK_SHELF_SLOT_04',
      'DRINK_SLOT_01', 'DRINK_SLOT_14', 'SNACK_SLOT_10',
      'COL_SnackShelf'], [1.00, 1.62], 2200 * 1.25],
    rangefinder_display: [['Case_Base', 'Tier_01', 'Tier_02', 'Acrylic_Front',
      'RF_SLOT_01', 'RF_SLOT_06', 'COL_RangefinderDisplay'],
    [0.60, 0.60, 0.35], 1100 * 1.25],
  };
  for (const [asset, [required, [w, h, d], cap]] of Object.entries(FIXTURES)) {
    const scene = (await kit.get(asset)).scene;
    const n = names(scene);
    for (const part of required) assert.ok(n.has(part), `${asset}: missing ${part}`);
    const s = sizeOf(scene);
    assert.ok(Math.abs(s.x - w) < 0.06, `${asset} width ${s.x.toFixed(3)} vs ${w}`);
    assert.ok(Math.abs(s.y - h) < 0.06, `${asset} height ${s.y.toFixed(3)} vs ${h}`);
    if (d != null) assert.ok(Math.abs(s.z - d) < 0.02, `${asset} depth ${s.z.toFixed(3)} vs ${d}`);
    let tris = 0;
    scene.traverse((o) => { if (o.isMesh && !o.name.startsWith('COL_')) tris += o.geometry.index.count / 3; });
    assert.ok(tris < cap, `${asset} tris ${tris} over ${cap}`);
  }
});

test('the Sheet-03 GLBs expose the exact stock-landing counts from the reference sheet', async () => {
  const kit = await kitPromise;
  const expected = {
    apparel_wall_display: { DISPLAY_ARM_SLOT_: 8, DISPLAY_BASE_SLOT_: 4 },
    hat_wall: { HAT_PEG_SLOT_: 16 },
    accessory_slatwall: { ACC_PRODUCT_SLOT_: 12, ACC_HOOK_SLOT_: 6, ACC_SHELF_SLOT_: 3 },
    club_rack: { CLUB_SLOT_: 10 },
    putter_rack: { PUTTER_SLOT_: 10 },
    bag_display: { BAG_SLOT_: 5 },
    shoe_wall: { SHOE_SLOT_: 6, SHOEBOX_SLOT_: 3 },
    ball_shelf: { BALL_SLOT_: 15 },
    snack_shelf: { DRINK_SLOT_: 14, SNACK_SLOT_: 10 },
    rangefinder_display: { RF_SLOT_: 6 },
  };
  for (const [asset, prefixes] of Object.entries(expected)) {
    const n = names((await kit.get(asset)).scene);
    for (const [prefix, count] of Object.entries(prefixes)) {
      assert.equal([...n].filter((name) => name.startsWith(prefix)).length, count,
        `${asset} ${prefix} count`);
    }
  }

  const clubNames = names((await kit.get('club_rack')).scene);
  assert.ok(![...clubNames].some((name) => /^CLUB_SLOT_[FR]/.test(name)), 'single-rank club rack has no legacy F/R sockets');

  const rangefinder = (await kit.get('rangefinder_display')).scene.getObjectByName('rangefinder_display');
  assert.deepEqual(rangefinder.userData.target_dimensions_m, [0.60, 0.35, 0.60],
    'Asset 30 metadata is width, depth, height');
});

test('the club rack seats a full-length driver: comb rail under the head, grip in the trough', async () => {
  const kit = await kitPromise;
  const scene = (await kit.get('club_rack')).scene;
  let slot = null;
  let railTop = null;
  scene.traverse((o) => {
    if (o.name === 'CLUB_SLOT_05') slot = o.getWorldPosition(new THREE.Vector3());
    if (o.name === 'Head_Tooth_04') {
      const box = new THREE.Box3().setFromObject(o);
      railTop = box.max.y;
    }
  });
  assert.ok(slot, 'centre slot exists');
  assert.ok(railTop !== null, 'comb tooth exists');
  // fixtureSlots stands a 1.05 shaft in the 0.055 trough: head pivot 1.105.
  // The head hangs 0.087 below its pivot, so it must SEAT on the comb: rail
  // top within a few mm under the head's underside.
  const headPivot = 0.055 + 1.05;
  const headUnderside = headPivot - 0.087;
  assert.ok(Math.abs(slot.y - 0.99) < 0.03, `comb slot height ${slot.y.toFixed(3)}`);
  assert.ok(headUnderside > railTop - 0.005 && headUnderside < railTop + 0.03,
    `driver underside ${headUnderside.toFixed(3)} vs rail top ${railTop.toFixed(3)}`);
});

test('the Sheet-04 furniture exposes its parts, sockets, envelopes and budgets', async () => {
  const kit = await kitPromise;
  // { asset: [ [required node names...], [w, h] envelope (x/y ±0.06), tri cap ] }
  const FURNITURE = {
    merch_table: [['Top', 'Lower_Shelf', 'Shelf_Rail_L', 'Leg_01', 'Leg_04', 'Crest_Badge',
      'MERCH_TABLE_SLOT_01', 'MERCH_TABLE_SLOT_06', 'MERCH_TABLE_LOWER_04',
      'COL_MerchTable'], [1.40, 0.75], 2200 * 1.25],
    retail_gondola: [['Plinth', 'Spine', 'Top_Cap', 'Shelf_F01', 'Shelf_B03',
      'End_Slat_L', 'End_Slat_R', 'GONDOLA_SLOT_F01', 'GONDOLA_SLOT_F12',
      'GONDOLA_SLOT_B12', 'COL_RetailGondola'], [1.20, 1.40], 3400 * 1.25],
    apparel_table: [['Top', 'Lower_Shelf', 'Leg_01', 'Crest_Badge',
      'APPAREL_TABLE_SLOT_01', 'APPAREL_TABLE_SLOT_08', 'APPAREL_TABLE_LOWER_04',
      'COL_ApparelTable'], [1.60, 0.80], 2300 * 1.25],
    stock_shelving: [['Post_LF', 'Post_RB', 'Board_01', 'Board_04', 'Board_Lip_01',
      'Brace_01a', 'Brace_03b', 'STOCK_SHELF_SLOT_01', 'STOCK_SHELF_SLOT_04',
      'COL_StockShelving'], [1.20, 2.00], 1800 * 1.25],
    storage_tote_olive: [['Tote_Body', 'Rim_F', 'Rim_L', 'Grip_L', 'Grip_R',
      'Label_Holder', 'Label_Card', 'TOTE_STACK_SOCKET',
      'COL_StorageTote_olive'], [0.60, 0.30], 600 * 1.25],
    lounge_armchair: [['Base', 'Seat_Cushion', 'Arm_L', 'Arm_Roll_R', 'Back',
      'Back_Cushion', 'Back_Roll', 'Foot_LF', 'COL_LoungeArmchair'], [0.85, 0.85], 2500 * 1.25],
    lounge_coffee_table: [['Top', 'Band', 'Leg_01', 'Leg_03', 'Support_Ring',
      'COL_LoungeCoffeeTable'], [1.00, 0.45], 1100 * 1.25],
    lounge_side_table: [['Top', 'Band', 'Leg_03', 'Support_Ring',
      'COL_LoungeSideTable'], [0.55, 0.38], 1100 * 1.25],
    office_desk: [['Top', 'Pedestal_L', 'Pedestal_R', 'Drawer_L01', 'Drawer_R03', 'Pull_L01',
      'Modesty_Panel', 'DESK_LAPTOP_SOCKET', 'COL_OfficeDesk'], [1.60, 0.75], 2800 * 1.25],
    office_chair: [['Star_Leg_01', 'Star_Leg_05', 'Caster_01', 'Gas_Lift', 'Seat', 'Back',
      'Arm_Post_L', 'Arm_Pad_R', 'COL_OfficeChair'], [0.65, 1.10], 1600 * 1.25],
    filing_cabinet: [['Body', 'Plinth', 'Drawer_01', 'Drawer_04', 'Pull_01',
      'Label_Frame_01', 'Label_01', 'Label_04', 'COL_FilingCabinet'], [0.48, 1.32], 800 * 1.25],
  };
  for (const [asset, [required, [w, h], cap]] of Object.entries(FURNITURE)) {
    const scene = (await kit.get(asset)).scene;
    const n = names(scene);
    for (const part of required) assert.ok(n.has(part), `${asset}: missing ${part}`);
    const s = sizeOf(scene);
    assert.ok(Math.abs(s.x - w) < 0.06, `${asset} width ${s.x.toFixed(3)} vs ${w}`);
    assert.ok(Math.abs(s.y - h) < 0.06, `${asset} height ${s.y.toFixed(3)} vs ${h}`);
    let tris = 0;
    scene.traverse((o) => { if (o.isMesh && !o.name.startsWith('COL_')) tris += o.geometry.index.count / 3; });
    assert.ok(tris < cap, `${asset} tris ${tris} over ${cap}`);
  }
});

test('the apparel table top carries the polo1 lane: eight clear stack positions', async () => {
  const kit = await kitPromise;
  const scene = (await kit.get('apparel_table')).scene;
  scene.updateMatrixWorld(true);
  const slots = [];
  scene.traverse((o) => { if (o.name.startsWith('APPAREL_TABLE_SLOT_')) slots.push(o.getWorldPosition(new THREE.Vector3())); });
  assert.equal(slots.length, 8, 'eight stack sockets');
  // every socket sits on the walnut top (0.80) and inside its edge with room
  // for a 0.30 x 0.25 folded polo around it
  for (const p of slots) {
    assert.ok(Math.abs(p.y - 0.801) < 0.01, `socket on the top: y ${p.y.toFixed(3)}`);
    assert.ok(Math.abs(p.x) + 0.15 <= 0.80, `folded polo inside the long edge at x ${p.x.toFixed(2)}`);
    assert.ok(Math.abs(p.z) + 0.125 <= 0.45, `folded polo inside the short edge at z ${p.z.toFixed(2)}`);
  }
  // stacks must not overlap: 0.38/0.42 pitch vs the 0.30 garment
  const xs = [...new Set(slots.map((p) => Math.round(p.x * 100) / 100))].sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) {
    assert.ok(xs[i] - xs[i - 1] >= 0.30, `stack pitch ${(xs[i] - xs[i - 1]).toFixed(2)} clears the garment`);
  }
  // and the fixtureSlots poses must match the sockets this table authors
  const { slotsFor } = await import('../src/data/fixtureSlots.js');
  const poses = slotsFor('polo1');
  assert.equal(poses.length, 12, 'polo1 keeps its capacity of 12');
  for (const pose of poses) {
    assert.ok(pose.folded, 'polo1 pose is folded');
    const hit = slots.some((p) => Math.abs(p.x - pose.x) < 0.03 && Math.abs(Math.abs(p.z) - Math.abs(pose.z)) < 0.03);
    assert.ok(hit, `polo1 pose (${pose.x}, ${pose.z}) lands on an authored socket`);
    assert.ok(pose.y >= 0.80 && pose.y <= 0.92, `polo1 stack height ${pose.y}`);
  }
});

test('the apparel wall display carries polo2 on eight arms and four folded sockets', async () => {
  const kit = await kitPromise;
  const scene = (await kit.get('apparel_wall_display')).scene;
  const n = names(scene);
  const poses = slotsFor('polo2');
  assert.equal(poses.length, 12, 'polo2 capacity matches its twelve authored landings');
  assert.equal(poses.filter((pose) => !pose.folded).length, 8, 'eight hanging polos');
  assert.equal(poses.filter((pose) => pose.folded).length, 4, 'four folded polos');
  for (const pose of poses) {
    assert.ok(pose.socketName, 'every polo2 pose resolves an authored node');
    assert.ok(n.has(pose.socketName), `apparel wall missing ${pose.socketName}`);
  }
});

test('the storage totes nest: the stack socket seats the next tote inside the rim', async () => {
  const kit = await kitPromise;
  for (const color of ['olive', 'slate', 'charcoal', 'stone']) {
    const scene = (await kit.get(`storage_tote_${color}`)).scene;
    scene.updateMatrixWorld(true);
    let sock = null;
    scene.traverse((o) => { if (o.name === 'TOTE_STACK_SOCKET') sock = o.getWorldPosition(new THREE.Vector3()); });
    assert.ok(sock, `${color}: stack socket exists`);
    // the next tote's base (0.52 x 0.34) drops just inside this tote's mouth,
    // slightly below the rim so the stack reads nested, not floated
    assert.ok(sock.y > 0.27 && sock.y < 0.30, `${color}: socket rides the rim at ${sock.y.toFixed(3)}`);
    assert.ok(Math.abs(sock.x) < 0.01 && Math.abs(sock.z) < 0.01, `${color}: socket centred`);
  }
});

test('no missing textures: every referenced image is embedded', async () => {
  const kit = await kitPromise;
  for (const [name, gltf] of kit) {
    const json = gltf.parser.json;
    for (const img of json.images || []) {
      assert.ok(Number.isInteger(img.bufferView), `${name}: image ${img.name || ''} embedded`);
    }
    // no cameras or lights exported
    assert.ok(!(json.cameras || []).length, `${name} has no cameras`);
    assert.ok(!json.extensionsUsed?.includes('KHR_lights_punctual'), `${name} has no lights`);
  }
});

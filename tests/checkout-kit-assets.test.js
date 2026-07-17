// Three.js load validation for the Prime Fairways checkout asset kit
// (assets/checkout/glb).  Uses the game's real GLTFLoader, mirroring
// tests/catalog-product-visual.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const KIT = [
  'checkout_counter', 'pos_monitor', 'cash_drawer', 'payment_terminal',
  'barcode_scanner', 'receipt_printer', 'shopping_bag', 'payment_card',
  'cash_bill_1', 'cash_bill_5', 'cash_bill_10', 'cash_bill_20', 'cash_bill_50',
  'cash_coin_01', 'cash_coin_05', 'cash_coin_10', 'cash_coin_25', 'cash_coin_50',
  'scannable_product_box', 'customer_display', 'loose_receipt', 'cash_handoff_stack',
  'apparel_wall',
  // Asset Sheet 03: the retail fixture family
  'apparel_wall_display', 'hat_wall', 'accessory_slatwall', 'club_rack',
  'putter_rack', 'bag_display', 'shoe_wall', 'ball_shelf', 'snack_shelf',
  'rangefinder_display',
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
  for (const c of ['01', '05', '10', '25', '50']) assert.ok(n.has(`COIN_${c}_SOCKET`), `COIN_${c}_SOCKET`);
  for (const part of ['CashDrawer_Housing', 'CashDrawer_Tray', 'CashDrawer_Insert', 'CashDrawer_Lock']) {
    assert.ok(n.has(part), part);
  }
  // clips target the tray
  const open = gltf.animations.find((a) => a.name === 'CashDrawer_Open');
  assert.ok(open.tracks.some((t) => t.name.includes('CashDrawer_Tray')), 'open animates tray');
});

test('payment terminal exposes every key + card socket; card fits the slot', async () => {
  const kit = await kitPromise;
  const term = (await kit.get('payment_terminal')).scene;
  const n = names(term);
  for (let d = 0; d <= 9; d++) assert.ok(n.has(`Terminal_Key_${d}`), `Terminal_Key_${d}`);
  for (const part of ['Terminal_Body', 'Terminal_Screen', 'Terminal_Keypad', 'Terminal_CancelButton',
    'Terminal_BackButton', 'Terminal_ConfirmButton', 'Terminal_ChipSlot', 'CARD_INSERT_SOCKET']) {
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
  const scn = names((await kit.get('barcode_scanner')).scene);
  for (const part of ['Scanner_Base', 'Scanner_Stand', 'Scanner_Head', 'Scanner_Window', 'Scanner_LED', 'SCAN_RAY_ORIGIN']) {
    assert.ok(scn.has(part), part);
  }
  const printer = await kit.get('receipt_printer');
  assert.deepEqual(printer.animations.map((a) => a.name), ['Receipt_Print']);
  const pn = names(printer.scene);
  for (const part of ['Printer_Body', 'Printer_Cover', 'Printer_OutputSlot', 'Printer_Button', 'Printer_LED', 'Receipt_Paper']) {
    assert.ok(pn.has(part), part);
  }
});

test('bag, product box and helpers expose their sockets', async () => {
  const kit = await kitPromise;
  const bag = names((await kit.get('shopping_bag')).scene);
  for (const part of ['Bag_Body', 'Bag_Handle_Left', 'Bag_Handle_Right', 'BAG_PICKUP_SOCKET',
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

test('denominations are correctly sized, centred and lightweight', async () => {
  const kit = await kitPromise;
  // Sheet-02 ladders: note length and coin diameter both grow with value
  const BILL_LEN = { 1: 0.122, 5: 0.132, 10: 0.142, 20: 0.149, 50: 0.156 };
  const COIN_DIA = { '01': 0.018, '05': 0.021, 10: 0.024, 25: 0.026, 50: 0.030 };
  for (const d of ['1', '5', '10', '20', '50']) {
    const scene = (await kit.get(`cash_bill_${d}`)).scene;
    const s = sizeOf(scene);
    assert.ok(Math.abs(s.x - BILL_LEN[d]) < 0.005, `bill ${d} length ${s.x}`);
    let tris = 0;
    scene.traverse((o) => { if (o.isMesh) tris += o.geometry.index.count / 3; });
    assert.ok(tris < 500, `bill ${d} tris ${tris}`);
  }
  for (const c of ['01', '05', '10', '25', '50']) {
    const scene = (await kit.get(`cash_coin_${c}`)).scene;
    const s = sizeOf(scene);
    assert.ok(Math.abs(s.x - COIN_DIA[c]) < 0.002, `coin ${c} diameter ${s.x}`);
    let tris = 0;
    scene.traverse((o) => { if (o.isMesh) tris += o.geometry.index.count / 3; });
    assert.ok(tris < 1000, `coin ${c} tris ${tris}`);
  }
});

test('apparel wall exposes its display parts and placement sockets', async () => {
  const kit = await kitPromise;
  const scene = (await kit.get('apparel_wall')).scene;
  const n = names(scene);
  for (const part of ['Slatwall', 'Back_Panel', 'Header', 'Header_Sign', 'Hanging_Rod',
    'Folded_Shelf', 'Cabinet_Body', 'Cabinet_Door_L', 'Cabinet_Door_R', 'COL_ApparelWall']) {
    assert.ok(n.has(part), `apparel wall missing ${part}`);
  }
  for (let i = 1; i <= 4; i++) assert.ok(n.has(`APPAREL_HANGER_SLOT_0${i}`), `hanger slot ${i}`);
  for (let i = 1; i <= 3; i++) assert.ok(n.has(`APPAREL_FOLD_SLOT_0${i}`), `fold slot ${i}`);
  for (let i = 1; i <= 2; i++) assert.ok(n.has(`APPAREL_SHELF_SLOT_0${i}`), `shelf slot ${i}`);
  for (let i = 1; i <= 2; i++) assert.ok(n.has(`APPAREL_HOOK_SLOT_0${i}`), `hook slot ${i}`);
  // module envelope: 1.10 wide, 2.20 tall (Y-up after import), 0.45 deep
  const s = sizeOf(scene);
  assert.ok(Math.abs(s.x - 1.10) < 0.05, `width ${s.x}`);
  assert.ok(Math.abs(s.y - 2.20) < 0.05, `height ${s.y}`);
  assert.ok(Math.abs(s.z - 0.45) < 0.05, `depth ${s.z}`);
  // the rod carries the hanger slots: they must sit ON the bar line
  let rodSlotY = null;
  scene.traverse((o) => { if (o.name === 'APPAREL_HANGER_SLOT_01') rodSlotY = o.getWorldPosition(new THREE.Vector3()).y; });
  assert.ok(rodSlotY !== null && Math.abs(rodSlotY - 1.68) < 0.02, `hanger slot height ${rodSlotY}`);
  let tris = 0;
  scene.traverse((o) => { if (o.isMesh && !o.name.startsWith('COL_')) tris += o.geometry.index.count / 3; });
  assert.ok(tris < 2800, `apparel wall tris ${tris}`);   // the Sheet-02 budget
});

test('the Sheet-03 fixtures expose their parts, sockets, envelopes and budgets', async () => {
  const kit = await kitPromise;
  // { asset: [ [required node names...], [w, h] envelope (x/z ±0.06), tri cap ] }
  const FIXTURES = {
    apparel_wall_display: [['Slatwall', 'Back_Panel', 'Header_Sign', 'Base_Shelf',
      'Faceout_Arm_01', 'Faceout_Arm_06', 'DISPLAY_ARM_SLOT_06', 'DISPLAY_BASE_SLOT_03',
      'COL_ApparelWallDisplay'], [1.20, 2.20], 2400 * 1.25],
    hat_wall: [['Slatwall', 'Back_Panel', 'Header_Sign', 'Peg_Arm_01', 'Peg_Arm_12',
      'HAT_PEG_SLOT_01', 'HAT_PEG_SLOT_12', 'COL_HatWall'], [1.00, 2.20], 1600 * 1.25],
    accessory_slatwall: [['Slatwall', 'Shelf_01', 'Shelf_03', 'Hook_Short_Plate_01',
      'Hook_Long_Plate_02', 'Hook_Double_Plate_02', 'ACC_SHELF_SLOT_03', 'ACC_HOOK_SLOT_06',
      'COL_AccessorySlatwall'], [1.00, 2.00], 1700 * 1.25],
    club_rack: [['Base', 'Head_Rail_F', 'Head_Rail_R', 'Trough_Felt_F', 'End_Cap_L',
      'CLUB_SLOT_F01', 'CLUB_SLOT_F09', 'CLUB_SLOT_R09', 'COL_ClubRack'], [1.20, 1.10], 2200 * 1.25],
    putter_rack: [['Base', 'Base_Felt', 'Grip_Rail', 'Groove_Divider_01', 'Groove_Divider_05',
      'PUTTER_SLOT_01', 'PUTTER_SLOT_06', 'COL_PutterRack'], [1.00, 1.00], 1800 * 1.25],
    bag_display: [['Deck', 'Lean_Rail', 'Rail_Post_L', 'BAG_SLOT_01', 'BAG_SLOT_04',
      'COL_BagDisplay'], [1.60, 1.10], 2600 * 1.25],
    shoe_wall: [['Slatwall', 'Display_Board_01', 'Display_Board_03', 'Box_Shelf',
      'SHOE_SLOT_01', 'SHOE_SLOT_06', 'SHOEBOX_SLOT_03',
      'COL_ShoeWall'], [1.20, 2.00], 2600 * 1.25],
    ball_shelf: [['Side_L', 'Board_01', 'Board_03', 'Board_Lip_01', 'BALL_SLOT_01',
      'BALL_SLOT_15', 'COL_BallShelf'], [1.00, 1.22], 1500 * 1.25],
    snack_shelf: [['Frame_Post_LF', 'Shelf_01', 'Shelf_04', 'SNACK_SHELF_SLOT_04',
      'DRINK_SLOT_01', 'DRINK_SLOT_14', 'SNACK_SLOT_10',
      'COL_SnackShelf'], [1.00, 1.62], 2200 * 1.25],
    rangefinder_display: [['Case_Base', 'Tier_01', 'Tier_02', 'Acrylic_Front',
      'RF_SLOT_01', 'RF_SLOT_06', 'COL_RangefinderDisplay'],
    [0.60, 0.35], 1100 * 1.25],
  };
  for (const [asset, [required, [w, h], cap]] of Object.entries(FIXTURES)) {
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

test('the club rack seats a full-length driver: comb rail under the head, grip in the trough', async () => {
  const kit = await kitPromise;
  const scene = (await kit.get('club_rack')).scene;
  let slot = null;
  let railTop = null;
  scene.traverse((o) => {
    if (o.name === 'CLUB_SLOT_F05') slot = o.getWorldPosition(new THREE.Vector3());
    if (o.name === 'Head_Tooth_F04') {
      const box = new THREE.Box3().setFromObject(o);
      railTop = box.max.y;
    }
  });
  assert.ok(slot, 'centre front slot exists');
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

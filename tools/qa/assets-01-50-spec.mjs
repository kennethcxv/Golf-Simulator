// Authoritative 1-50 asset mapping transcribed from the five composite sheets.
// This is deliberately data-only so the audit, manifest tests, Blender checks,
// and runtime acceptance tools can share one numbering contract.

export const SHEETS = Object.freeze({
  1: 'Designs/RefrenceImages/1-10_refrence_images/DB044B74-C295-4613-894E-F3869F543F1B.jpg',
  2: 'Designs/RefrenceImages/11-20_refrence_images/29E40B57-F81D-4BA8-AA27-2EEB8E368E21.png',
  3: 'Designs/RefrenceImages/21-30_refrence_images/4812B19F-BF56-47C8-B2F1-F2DBC8FCD76B.jpg',
  4: 'Designs/RefrenceImages/31-40_refrence_images/ChatGPT Image Jul 16, 2026, 07_34_18 PM.png',
  5: 'Designs/RefrenceImages/41-50_refrence_images/ChatGPT Image Jul 17, 2026, 11_45_44 AM.png',
});

const CHECKOUT_RUNTIME = Object.freeze([
  'src/render3d/clubhouse.js',
  'src/render3d/clubhouse/fixtures.js',
  'src/render3d/clubhouse/merch.js',
  'src/render3d/clubhouse/simplifiedRegisterMode.js',
  'src/sim/register.js',
  'src/sim/state.js',
]);
const FIXTURE_RUNTIME = Object.freeze([
  'src/render3d/clubhouse.js',
  'src/render3d/clubhouse/fixtures.js',
  'src/render3d/clubhouse/merch.js',
  'src/data/fixtureSlots.js',
]);
const DELIVERY_EQUIPMENT_RUNTIME = Object.freeze([
  'src/render3d/clubhouse/deliveryEquipment.js',
  'src/render3d/clubhouse.js',
  'src/data/deliveryEquipment.js',
  'src/sim/deliveries.js',
]);
const DELIVERY_BOX_RUNTIME = Object.freeze([
  'src/render3d/clubhouse/deliveryBoxVisual.js',
  'src/render3d/clubhouse.js',
  'src/sim/deliveries.js',
  'src/data/boxes.js',
]);

const defs = [
  [1, 'CHECKOUT COUNTER', 'checkout_counter', 'Player-facing checkout workstation', { width: 2.00, height: 0.90, depth: 0.70 }, 4800, [2048, 2048], 'Checkout island', 'Enter register mode; stage and bag products', 'Static shell; runtime item motion', {
    pathOverride: {
      source: 'asset_sources/blender/cash_register/checkout_counter.blend',
      canonicalGlb: 'vendor/models/clubhouse/checkout_counter.glb',
      runtimeGlb: 'vendor/models/clubhouse/checkout_counter.glb',
    },
    supportingPaths: [{
      source: 'Assets/checkout/source/checkout_counter.blend',
      canonicalGlb: 'Assets/checkout/glb/checkout_counter.glb',
      runtimeGlb: 'vendor/models/checkout/checkout_counter.glb',
      role: 'zero-network fallback counter',
    }],
  }],
  [2, 'POS TOUCHSCREEN MONITOR', 'pos_monitor', 'Itemised checkout display', { width: 0.38, height: 0.32, depth: 0.22 }, 3100, [2048, 2048], 'Cashier side of checkout counter', 'Live transaction UI and feedback', 'Screen material/UI updates'],
  [3, 'PAYMENT TERMINAL (CARD READER)', 'payment_terminal', 'Physical card-payment terminal', { width: 0.09, height: 0.06, depth: 0.16 }, 2900, [2048, 2048], 'Cashier side of checkout counter', 'Mouse-driven physical card swipe', 'Card travels through reader channel'],
  [4, 'CASH DRAWER', 'cash_drawer', 'Physical received-cash and change workspace', { width: 0.41, height: 0.10, depth: 0.41 }, 6200, [2048, 2048], 'Under checkout worktop', 'Deposit received cash; select change', 'Drawer slide; money-piece motion'],
  [5, 'RECEIPT PRINTER', 'receipt_printer', 'Physical receipt output', { width: 0.16, height: 0.12, depth: 0.18 }, 2300, [2048, 2048], 'Checkout counter', 'Print and collect receipt', 'Receipt paper feed/cut'],
  [6, 'SHOPPING BAG (UPRIGHT)', 'shopping_bag', 'Product bagging and customer handoff', { width: 0.30, height: 0.35, depth: 0.18 }, 1900, [2048, 2048], 'Checkout bagging zone', 'Bag products and hand completed bag to customer', 'Bag fill state and handoff motion'],
  [7, 'PAYMENT CARD', 'payment_card', 'Customer card used for payment', { width: 0.086, height: 0.054, depth: 0.0008 }, 300, [1024, 1028], 'Customer hand / payment terminal', 'Mouse-driven swipe through card reader', 'Swipe path'],
  [8, 'RECEIPT', 'loose_receipt', 'Printed transaction proof', { width: 0.075, height: null, depth: 0.0002 }, 200, [1024, 2048], 'Receipt printer / customer handoff', 'Pick up and deliver receipt', 'Print, curl, pickup and handoff'],
  [9, 'BANKNOTE (20)', 'cash_bill_20', 'Twenty-unit cash tender/change piece', { width: 0.156, height: 0.066, depth: 0.0001 }, 80, [1024, 512], 'Cash drawer and customer hand', 'Deposit or select as change', 'Rigid-body-style hand/drawer motion'],
  [10, 'COIN (5)', 'cash_coin_05_sheet01', 'Large five-unit hero coin from Sheet 1', { diameter: 0.024, thickness: 0.0018 }, 250, [1024, 1024], 'Customer tender hand; Asset 18 remains the drawer/change five-unit coin', 'Deposit incoming tender while preserving the logical five-unit denomination', 'Rigid-body-style customer-hand and drawer-deposit motion'],

  [11, 'BILL - 50 UNIT', 'cash_bill_50', 'Fifty-unit cash tender/change piece', { width: 0.156, height: 0.066, depth: 0.0001 }, 80, [1024, 512], 'Cash drawer and customer hand', 'Deposit or select as change', 'Rigid-body-style hand/drawer motion'],
  [12, 'BILL - 10 UNIT', 'cash_bill_10', 'Ten-unit cash tender/change piece', { width: 0.142, height: 0.061, depth: 0.0001 }, 80, [1024, 512], 'Cash drawer and customer hand', 'Deposit or select as change', 'Rigid-body-style hand/drawer motion'],
  [13, 'BILL - 5 UNIT', 'cash_bill_5', 'Five-unit cash tender/change piece', { width: 0.132, height: 0.057, depth: 0.0001 }, 80, [1024, 512], 'Cash drawer and customer hand', 'Deposit or select as change', 'Rigid-body-style hand/drawer motion'],
  [14, 'BILL - 1 UNIT', 'cash_bill_1', 'One-unit cash tender/change piece', { width: 0.122, height: 0.054, depth: 0.0001 }, 80, [1024, 512], 'Cash drawer and customer hand', 'Deposit or select as change', 'Rigid-body-style hand/drawer motion'],
  [15, 'COIN - 50 UNIT', 'cash_coin_50', 'Fifty-unit cash tender/change piece', { diameter: 0.030, thickness: 0.0022 }, 300, [1024, 1024], 'Cash drawer and customer hand', 'Deposit or select as change', 'Rigid-body-style hand/drawer motion'],
  [16, 'COIN - 20 UNIT', 'cash_coin_20', 'Twenty-unit cash tender/change piece', { diameter: 0.026, thickness: 0.0020 }, 280, [1024, 1024], 'Cash drawer and customer hand', 'Deposit or select as change', 'Rigid-body-style hand/drawer motion'],
  [17, 'COIN - 10 UNIT', 'cash_coin_10', 'Ten-unit cash tender/change piece', { diameter: 0.024, thickness: 0.0018 }, 250, [1024, 1024], 'Cash drawer and customer hand', 'Deposit or select as change', 'Rigid-body-style hand/drawer motion'],
  [18, 'COIN - 5 UNIT', 'cash_coin_05', 'Small five-unit coin from Sheet 2', { diameter: 0.021, thickness: 0.0016 }, 220, [1024, 1024], 'Cash drawer and change hand', 'Select or return as change', 'Rigid-body-style hand/drawer motion'],
  [19, 'COIN - 1 UNIT', 'cash_coin_01', 'One-unit cash tender/change piece', { diameter: 0.018, thickness: 0.0014 }, 180, [1024, 1024], 'Cash drawer and customer hand', 'Deposit or select as change', 'Rigid-body-style hand/drawer motion'],
  [20, 'APPAREL WALL FIXTURE', 'apparel_wall', 'Compact apparel wall with hanging and folded stock', { width: 1.20, height: 2.20, depth: 0.45 }, 2800, [2048, 2048], 'Pro-shop apparel wall', 'Stocking, customer pickup, save/load', 'Static fixture'],

  [21, 'APPAREL WALL DISPLAY', 'apparel_wall_display', 'Full apparel slatwall display', { width: 1.20, height: 2.20, depth: 0.45 }, 2400, [2048, 2048], 'Pro-shop apparel wall', 'Stocking, customer pickup, save/load', 'Static fixture'],
  [22, 'HAT WALL DISPLAY', 'hat_wall', 'Pegged hat wall', { width: 1.00, height: 2.20, depth: 0.30 }, 1600, [2048, 2048], 'Pro-shop hat wall', 'Stocking, customer pickup, save/load', 'Static fixture'],
  [23, 'ACCESSORY SLATWALL', 'accessory_slatwall', 'Hook and shelf accessory wall', { width: 1.00, height: 2.00, depth: 0.30 }, 1700, [2048, 2048], 'Pro-shop accessories wall', 'Stocking, customer pickup, save/load', 'Static fixture'],
  [24, 'CLUB RACK DISPLAY', 'club_rack', 'Floor rack for full-length clubs', { width: 1.20, height: 1.10, depth: 0.40 }, 2200, [2048, 2048], 'Pro-shop club wall', 'Stocking, customer pickup, save/load', 'Static fixture'],
  [25, 'PUTTER RACK DISPLAY', 'putter_rack', 'Floor rack for putters', { width: 1.00, height: 1.00, depth: 0.35 }, 1800, [2048, 2048], 'Pro-shop club wall', 'Stocking, customer pickup, save/load', 'Static fixture'],
  [26, 'GOLF BAG DISPLAY', 'bag_display', 'Floor display for golf bags', { width: 1.60, height: 1.10, depth: 0.40 }, 2600, [2048, 2048], 'Pro-shop bag area', 'Stocking, customer pickup, save/load', 'Static fixture'],
  [27, 'SHOE WALL DISPLAY', 'shoe_wall', 'Angled golf-shoe wall', { width: 1.20, height: 2.00, depth: 0.35 }, 2600, [2048, 2048], 'Pro-shop shoe wall', 'Stocking, customer pickup, save/load', 'Static fixture'],
  [28, 'GOLF BALL SHELF', 'ball_shelf', 'Golf-ball box shelving', { width: 1.00, height: 1.20, depth: 0.35 }, 1500, [2048, 2048], 'Pro-shop ball wall', 'Stocking, customer pickup, save/load', 'Static fixture'],
  [29, 'SNACK & DRINK SHELF', 'snack_shelf', 'Multi-level snack and beverage shelf', { width: 1.00, height: 1.60, depth: 0.45 }, 2200, [2048, 2048], 'Pro-shop impulse retail area', 'Stocking, customer pickup, checkout, save/load', 'Static fixture'],
  [30, 'RANGEFINDER DISPLAY', 'rangefinder_display', 'Countertop optics display', { width: 0.60, height: 0.60, depth: 0.35 }, 1100, [2048, 2048], 'Pro-shop back counter', 'Stocking, customer pickup, checkout, save/load', 'Static fixture'],

  [31, 'CENTER MERCHANDISE TABLE', 'merch_table', 'Two-tier folded-merchandise table', { width: 1.40, height: 0.75, depth: 0.80 }, 2200, [2048, 2048], 'Center of pro-shop floor', 'Stocking, placement, customer pickup, save/load', 'Static fixture'],
  [32, 'FREESTANDING GONDOLA', 'retail_gondola', 'Double-sided freestanding retail gondola', { width: 1.20, height: 1.40, depth: 0.60 }, 3400, [2048, 2048], 'Center of pro-shop floor', 'Stocking, placement, customer pickup, save/load', 'Static fixture'],
  [33, 'FOLDED APPAREL TABLE', 'apparel_table', 'Large folded-clothing table', { width: 1.60, height: 0.80, depth: 0.90 }, 2300, [2048, 2048], 'Center of pro-shop floor', 'Stocking, placement, customer pickup, save/load', 'Static fixture'],
  [34, 'STOCKROOM SHELVING UNIT', 'stock_shelving', 'Heavy-duty four-shelf stockroom rack', { width: 1.20, height: 2.00, depth: 0.50 }, 1800, [1024, 1024], 'Stockroom', 'Back-stock storage, collision, save/load', 'Static fixture'],
  [35, 'BACKROOM BINS & TOTES', 'storage_tote_olive', 'Stackable labeled inventory tote family', { width: 0.60, height: 0.30, depth: 0.40 }, 600, [1024, 1024], 'Stockroom shelves and floor', 'Stacking, inventory storage, save/load', 'Static; stack state', { supportingStems: ['storage_tote_slate', 'storage_tote_charcoal', 'storage_tote_stone'] }],
  [36, 'LOUNGE ARMCHAIR', 'lounge_armchair', 'Player/customer lounge seating', { width: 0.85, height: 0.85, depth: 0.85 }, 2500, [2048, 2048], 'Pro-shop lounge', 'Furniture placement and collision', 'Static furniture'],
  [37, 'LOUNGE COFFEE TABLE', 'lounge_coffee_table', 'Round lounge table family', { diameter: 1.00, height: 0.45 }, 1100, [1024, 1024], 'Pro-shop lounge', 'Furniture placement and collision', 'Static furniture', { supportingStems: ['lounge_side_table'] }],
  [38, 'OFFICE DESK', 'office_desk', 'Executive office desk', { width: 1.60, height: 0.75, depth: 0.80 }, 2800, [2048, 2048], 'Clubhouse office', 'Furniture placement; laptop anchor', 'Static desk; laptop interaction is separate'],
  [39, 'OFFICE CHAIR', 'office_chair', 'Adjustable swivel office chair', { width: 0.65, height: 1.10, depth: 0.65 }, 1600, [1024, 1024], 'Clubhouse office', 'Furniture placement and collision', 'Static chair'],
  [40, 'FILING CABINET', 'filing_cabinet', 'Four-drawer office storage cabinet', { width: 0.48, height: 1.32, depth: 0.62 }, 800, [1024, 1024], 'Clubhouse office', 'Furniture placement and collision', 'Static cabinet'],

  [41, 'DELIVERY VAN', 'delivery_van', 'Animated supplier delivery vehicle and cargo volume', { length: 5.50, width: 2.00, height: 2.40 }, 8000, [2048, 2048], 'Exterior delivery service bay', 'Arrival, cargo reveal/unload, collision', 'Approach, cargo-door open/close, depart'],
  [42, 'HAND TRUCK (DOLLY)', 'delivery_hand_truck', 'Box-moving hand truck', { width: 0.50, height: 1.20, depth: 0.45 }, 1200, [1024, 1024], 'Stockroom equipment bay', 'Normal-focus use and box transport', 'Tilt and wheel motion'],
  [43, 'STOCKING CART', 'delivery_stocking_cart', 'Three-deck mobile stocking cart', { length: 1.00, width: 0.50, height: 0.95 }, 2100, [1024, 1024], 'Stockroom equipment bay', 'Place/remove cartons; save/load', 'Wheel/cart movement'],
  [44, 'PALLET', 'delivery_wooden_pallet', 'Delivery-box staging pallet', { length: 1.20, width: 1.00, height: 0.14 }, 900, [1024, 1024], 'Exterior receiving pad', 'Stack boxes; pallet-jack coupling; collision', 'Static pallet; coupled lift'],
  [45, 'PALLET JACK', 'delivery_pallet_jack', 'Hydraulic pallet mover', { length: 1.55, width: 0.70, height: 1.20 }, 1800, [1024, 1024], 'Exterior receiving pad', 'Normal-focus lift/lower and pallet coupling', 'Handle articulation and fork lift'],
  [46, 'GENERIC MERCHANDISE BOX', 'delivery_generic_merchandise_box', 'General product delivery carton', { length: 0.60, width: 0.40, height: 0.40 }, 600, [1028, 2044], 'Van, pallet, cart, stockroom', 'Carry, cut, open, unpack, stock, recycle, save/load', 'Tape cut, four flaps, collapse'],
  [47, 'APPAREL BOX', 'delivery_apparel_box', 'Apparel-specific delivery carton', { length: 0.60, width: 0.40, height: 0.35 }, 600, [1024, 1024], 'Van, pallet, cart, stockroom', 'Carry, cut, open, unpack apparel, recycle, save/load', 'Tape cut, four flaps, collapse'],
  [48, 'GOLF CLUB BOX', 'delivery_golf_club_box', 'Long padded golf-club delivery carton', { length: 1.25, width: 0.18, height: 0.18 }, 1200, [1024, 1024], 'Van, pallet, cart, stockroom', 'Carry, cut, open, unpack clubs, recycle, save/load', 'Tape cut, long flaps, collapse'],
  [49, 'BOX CUTTER', 'delivery_box_cutter', 'Held tool for cutting carton tape', { length: 0.16, width: 0.04, height: 0.02 }, 500, [1024, 1024], 'Packing bench / player hand', 'Equip and cut delivery-box tape', 'Held hand motion; retractable blade presentation'],
  [50, 'PACKING TAPE ROLL', 'delivery_packing_tape_roll', 'Clear packing-tape support prop', { diameter: 0.10, width: 0.05 }, 300, [1024, 1024], 'Packing bench / delivery presentation', 'Packing and unpacking feedback prop', 'Static roll'],
];

function pathsFor(number, stem, extra = {}) {
  if (number <= 40) {
    const supporting = (extra.supportingStems || []).map((item) => ({
      source: `Assets/checkout/source/${item}.blend`,
      canonicalGlb: `Assets/checkout/glb/${item}.glb`,
      runtimeGlb: `vendor/models/checkout/${item}.glb`,
    })).concat(extra.supportingPaths || []);
    return {
      source: `Assets/checkout/source/${stem}.blend`,
      canonicalGlb: `Assets/checkout/glb/${stem}.glb`,
      runtimeGlb: `vendor/models/checkout/${stem}.glb`,
      supporting,
      ...(extra.pathOverride || {}),
    };
  }
  return {
    source: `asset_sources/blender/delivery/${stem}.blend`,
    canonicalGlb: null,
    runtimeGlb: `vendor/models/clubhouse/${stem}.glb`,
    supporting: [],
  };
}

function runtimeFor(number) {
  if (number <= 19) return [...CHECKOUT_RUNTIME];
  if (number <= 40) return [...FIXTURE_RUNTIME];
  if (number <= 45) {
    const files = [...DELIVERY_EQUIPMENT_RUNTIME];
    if (number === 41) files.push('src/data/deliveryVanCargo.js');
    if (number === 44 || number === 45) files.push('src/data/deliveryStaging.js');
    return files;
  }
  const files = [...DELIVERY_BOX_RUNTIME];
  if (number === 49) files.push('src/render3d/fpHands.js', 'src/render3d/courseScene.js');
  return files;
}

export const ASSETS = Object.freeze(defs.map((definition) => {
  const [number, referenceName, stem, purpose, intendedDimensions, referencePolygons,
    referenceTextureSize, placement, interaction, animation, extra = {}] = definition;
  const sheet = Math.ceil(number / 10);
  return Object.freeze({
    assetNumber: number,
    referenceSheet: sheet,
    referenceImagePath: SHEETS[sheet],
    referenceName,
    intendedGameplayPurpose: purpose,
    stem,
    ...pathsFor(number, stem, extra),
    runtimeIntegrationFiles: runtimeFor(number),
    fixtureOrPlacementLocation: placement,
    intendedDimensions,
    referencePolygonNote: `approximately ${referencePolygons}`,
    referenceTextureSize,
    interactionType: interaction,
    animationRequirements: animation,
    collisionExpected: ![2, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 50].includes(number),
    socketExpected: [1, 3, 4, 5, 6, 8].includes(number) || (number >= 20 && number <= 49),
    duplicateContract: extra.duplicateContract || null,
    missingContract: extra.missingContract || null,
  });
}));

if (ASSETS.length !== 50 || ASSETS.some((asset, index) => asset.assetNumber !== index + 1)) {
  throw new Error('Asset 01-50 spec must contain exactly one ordered record for each number.');
}

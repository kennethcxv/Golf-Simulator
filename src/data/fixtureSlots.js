// WHERE EVERY UNIT OF STOCK PHYSICALLY STANDS.
//
// A shelf holds what it has room for. That sentence used to be false in two directions at once:
// the sim enforced a capacity from a category table (accessories: 24) and the renderer drew a
// different number from a magic minimum (`Math.min(count, 12)`), and nothing compared them. So a
// full accessories shelf looked half empty, a full ball wall drew fifteen of its twenty-four and
// padded the gap with a row of boxes standing BEHIND the front row representing no stock at all,
// and a golf-bag platform had a capacity of twenty-four stand bags.
//
// Capacity is not a number now. It is the number of PLACES there are to put one. The sim asks how
// many slots a line has and refuses to stack past it; the renderer walks the same list and puts one
// item in each. They cannot drift, because there is only one of them.
//
// A slot is a POSE, not just a point — a club leans, a cap faces out off the tree, a shoe angles on
// its board — so the renderer gets everything it needs to place the mesh and nothing it needs to
// invent. Coordinates are FIXTURE-LOCAL yards; the fixture's own anchor puts them in the room.
//
// Board heights come straight from the millwork (render3d/clubhouse/fixtures.js keeps the contract
// at the top of the file). Move a board there and the stock will float; the tests below will say so.

import { FIXTURES } from './shopLayout.js';

// Sheet-03 kit module geometry (assets/checkout). Positions are FIXTURE-LOCAL:
// module centres along x, board TOP surfaces as measured from the authored GLBs.
const ACC_MODULES = [-1.0, 0.0, 1.0];      // three 1.0 m slatwall/shelf modules per wall run
const ACC_MODULE_TAGS = ['L', 'C', 'R'];
const ACC_SHELF_TOPS = [0.562, 0.962, 1.362];   // accessory_slatwall bracket shelves
const BALL_BOARD_TOPS = [0.317, 0.657, 0.997];  // ball_shelf boards
const SHOE_ROWS = [0.62, 1.02, 1.42];      // shoe_wall display boards (angled -0.18)
const HAT_ROWS = [0.62, 1.02, 1.42, 1.82]; // hat_wall peg rows
const CLUB_SLOT_XS = Array.from({ length: 10 }, (_, k) => (k - 4.5) * 0.105); // club_rack comb

// The snack_shelf GLB authors named sockets for every sellable unit. Keep the
// exact node translations and names here so capacity, stocking, and the future
// runtime renderer all share the physical shelf contract.
function authoredSnackrackSlots(prefix, xs, rows, z) {
  return Object.freeze(rows.flatMap((y, row) => xs.map((x, col) => Object.freeze({
    socket: `${prefix}_${String(row * xs.length + col + 1).padStart(2, '0')}`,
    socketName: `${prefix}_${String(row * xs.length + col + 1).padStart(2, '0')}`,
    x, y, z, ry: 0,
  }))));
}

export const SNACKRACK_AUTHORED_SLOTS = Object.freeze({
  water1: authoredSnackrackSlots(
    'DRINK_SLOT',
    [-0.39, -0.26, -0.13, 0, 0.13, 0.26, 0.39],
    [0.174, 0.574],
    0.055,
  ),
  snack1: authoredSnackrackSlots(
    'SNACK_SLOT',
    [-0.35, -0.175, 0, 0.175, 0.35],
    [0.954, 1.284],
    0.03,
  ),
});

// --- who lives where ------------------------------------------------------------------------
const HOME = new Map();
for (const f of FIXTURES) {
  f.skus.forEach((id, i) => HOME.set(id, { fixture: f, lane: i, lanes: f.skus.length }));
}

export function homeFixture(skuId) {
  const h = HOME.get(skuId);
  return h ? h.fixture : null;
}
export function laneOf(skuId) {
  const h = HOME.get(skuId);
  return h ? h.lane : 0;
}

// Repeated GLB modules carry the same local node names. fixtures.js prefixes
// every instantiated socket with the owning fixture and module tag, giving the
// logical inventory slot one unambiguous authored transform to resolve.
function moduleSocket(skuId, moduleTag, localName) {
  const h = HOME.get(skuId);
  return h ? `${h.fixture.id}_${moduleTag}_${localName}` : localName;
}

// the centre of this line's strip of a shared fixture
function laneX(skuId, usable) {
  const h = HOME.get(skuId);
  if (!h) return 0;
  const w = usable / Math.max(1, h.lanes);
  return -usable / 2 + w * (h.lane + 0.5);
}

// --- the generators -------------------------------------------------------------------------
// Each returns its slots BOTTOM BOARD FIRST, left to right. The order is load-bearing: three boxes
// on a wall unit have to sit on the bottom shelf, not float on the top one with nothing beneath.

// The Sheet-03 club rack: two 1.20 m double-comb modules at x ±0.60. Clubs
// stand FULL LENGTH, grip in the felt trough, shaft through a comb slot, head
// seated on the rail (headUp tells the renderer to build the club downward
// from the head). The front rank fills first; wedges take the rear rank of
// the irons rack, peeking over the spine exactly like the sheet's angled view.
function clubRack(skuId, len) {
  const h = HOME.get(skuId);
  const lane = h ? h.lane : 0;
  const lanes = h ? h.lanes : 1;
  const positions = [];
  for (const [moduleIndex, m] of [-0.6, 0.6].entries()) {
    for (let k = 0; k < CLUB_SLOT_XS.length; k++) {
      positions.push({
        x: m + CLUB_SLOT_XS[k], y: 0.055 + len, z: 0.015,
        len, headUp: true, lean: [-0.025, 0, 0.025][k % 3],
        ry: positions.length % 2 ? -0.14 : 0.14,
        socketName: moduleSocket(skuId, moduleIndex ? 'R' : 'L', `CLUB_SLOT_${String(k + 1).padStart(2, '0')}`),
        socketOffset: { y: (0.055 + len) - 0.99 },
      });
    }
  }
  // Three driver lines retain six positions each (18/20 used). Four iron and
  // wedge lines divide the complete twenty-position run five apiece.
  const width = lanes >= 4 ? 5 : 6;
  return positions.slice(lane * width, lane * width + width);
}

// the putter rack: two 1.00 m groove modules at x ±0.53, heads down in the
// felt grooves (the game's native head-at-slot pose), grips on the rail
function putterRack(skuId) {
  const h = HOME.get(skuId);
  const right = h && h.lane === 1;
  const m = right ? 0.5 : -0.5;
  const tag = right ? 'R' : 'L';
  return Array.from({ length: 10 }, (_, k) => ({
    x: m + (k - 4.5) * 0.09,
    y: 0.185,
    z: 0.045 - (k % 2) * 0.055,
    lean: (k % 2) * 0.04 - 0.02,
    len: 0.80,
    ry: 0.12 + (k % 2) * 0.10,
    socketName: moduleSocket(skuId, tag, `PUTTER_SLOT_${String(k + 1).padStart(2, '0')}`),
  }));
}

// dozen-boxes fronted on a ball_shelf module — one module per line
function ballModule(skuId) {
  const h = HOME.get(skuId);
  const lane = h ? h.lane : 0;
  const m = ACC_MODULES[lane];
  const tag = ACC_MODULE_TAGS[lane];
  const out = [];
  for (let row = 0; row < BALL_BOARD_TOPS.length; row++) {
    const top = BALL_BOARD_TOPS[row];
    for (let c = 0; c < 5; c++) {
      const index = row * 5 + c + 1;
      out.push({
        x: m + (c - 2) * 0.175, y: top + 0.0605, z: 0.09,
        socketName: moduleSocket(skuId, tag, `BALL_SLOT_${String(index).padStart(2, '0')}`),
        socketOffset: { y: 0.0600 },
      });
    }
  }
  return out;
}

// cartons/rolls on an accessory_slatwall module's bracket shelves.
// mx picks the module, ox a block offset within it (markers and towels share
// the middle module as left/right blocks).
function accShelf(cols, pitch, lift, { mx = 0, ox = 0, z = 0.02, ry = 0 } = {}) {
  const out = [];
  for (const top of ACC_SHELF_TOPS) {
    for (let c = 0; c < cols; c++) {
      out.push({ x: mx + ox + (c - (cols - 1) / 2) * pitch, y: top + lift, z, ry });
    }
  }
  return out;
}

const ACC_HOOKS = [
  [-0.30, 1.54, 0.075], [0.30, 1.54, 0.075],
  [0.0, 1.54, 0.130], [0.0, 1.72, 0.130],
  [-0.30, 1.72, 0.105], [0.30, 1.72, 0.105],
];

function authoredAccessoryProducts(skuId, lane) {
  const mx = ACC_MODULES[lane];
  const tag = ACC_MODULE_TAGS[lane];
  return Array.from({ length: 12 }, (_, index) => {
    const row = Math.floor(index / 4);
    const col = index % 4;
    return {
      x: mx + (col - 1.5) * 0.23,
      y: ACC_SHELF_TOPS[row], z: 0,
      socketName: moduleSocket(skuId, tag, `ACC_PRODUCT_SLOT_${String(index + 1).padStart(2, '0')}`),
    };
  });
}

function authoredAccessoryHooks(skuId, lane, productDrop) {
  const mx = ACC_MODULES[lane];
  const tag = ACC_MODULE_TAGS[lane];
  return ACC_HOOKS.map(([x, y, arm], index) => ({
    x: mx + x, y: y - 0.012 + productDrop, z: arm - 0.095,
    ry: 0, hangingPackage: true,
    socketName: moduleSocket(skuId, tag, `ACC_HOOK_SLOT_${String(index + 1).padStart(2, '0')}`),
    socketOffset: { y: productDrop, z: 0.025 },
  }));
}

function accessoryHybrid(skuId, lane, productDrop) {
  const shelf = authoredAccessoryProducts(skuId, lane);
  const centredShelfPairs = [1, 2, 5, 6, 9, 10].map((index) => shelf[index]);
  return [...authoredAccessoryHooks(skuId, lane, productDrop), ...centredShelfPairs];
}

// folded stacks on the Sheet-04 apparel_table (kit top surface 0.80; stack
// positions match the table's APPAREL_TABLE_SLOT grid at x ±0.57/±0.19,
// z ±0.21). Each lane owns four stacks of three — polo1 the west pair of
// columns, polo2 the east pair. Twelve per lane, same capacity as ever.
function tableApparel(skuId) {
  const h = HOME.get(skuId);
  const lane = laneOf(skuId);
  const colXs = h && h.lanes === 1
    ? [-0.57, -0.19, 0.19, 0.57]
    : lane === 0 ? [-0.57, -0.19] : [0.19, 0.57];
  const out = [];
  for (let i = 0; i < 12; i++) {             // four stacks of three, folded
    const stack = Math.floor(i / 3);
    out.push({
      x: colXs[stack % colXs.length],
      y: 0.801 + (i % 3) * 0.055,
      z: stack < 2 ? -0.21 : 0.21,
      ry: (i % 2) * 0.09 - 0.045,
      folded: true,
    });
  }
  return out;
}

export const APPAREL_DISPLAY_TINTS = Object.freeze([
  0x315c43, 0x365f85, 0x6f493f, 0xd8d1bf,
  0x82957c, 0x2f4f3b, 0x53688c, 0xb8aa91,
]);

function apparelDisplay() {
  const hanging = Array.from({ length: 8 }, (_, i) => ({
    x: [-0.405, -0.135, 0.135, 0.405][i % 4],
    y: i < 4 ? 2.0 : 1.20,
    z: 0.18 + (i % 2) * 0.012,
    ry: (i % 2) * 0.06 - 0.03,
    socketName: `DISPLAY_ARM_SLOT_${String(i + 1).padStart(2, '0')}`,
    tint: APPAREL_DISPLAY_TINTS[i],
  }));
  const folded = [-0.405, -0.135, 0.135, 0.405].map((x, i) => ({
    x, y: 0.272, z: 0.02, folded: true, ry: (i % 2) * 0.06 - 0.03,
    socketName: `DISPLAY_BASE_SLOT_${String(i + 1).padStart(2, '0')}`,
    tint: APPAREL_DISPLAY_TINTS[i + 4],
  }));
  return [...hanging, ...folded];
}

// Sheet-02 Asset 20 is one 1.20 m apparel wall: four hangers, then two folded
// jackets on each open lower shelf. These coordinates are the immediate-load
// fallback; once the GLB arrives the renderer resolves the matching socketName
// under the actual fixture anchor. Keeping the tint on the slot makes a part-full
// display deterministic across restock, sale, save and reload.
export const APPAREL_TINTS = Object.freeze([0x365f85, 0xd8d1bf, 0x315c43, 0x82957c]);

function apparelWall() {
  const hangers = [-0.405, -0.135, 0.135, 0.405].map((x, i) => ({
    x, y: 1.68, z: 0, ry: 0,
    socketName: `APPAREL_HANGER_SLOT_${String(i + 1).padStart(2, '0')}`,
    tint: APPAREL_TINTS[i],
  }));
  const folded = [
    [-0.27, 0.332], [0.27, 0.332],
    [-0.27, 0.632], [0.27, 0.632],
  ].map(([x, y], i) => ({
    x, y, z: 0.03, ry: 0, folded: true,
    socketName: `APPAREL_FOLD_SLOT_${String(i + 1).padStart(2, '0')}`,
    tint: APPAREL_TINTS[i],
  }));
  return [...hangers, ...folded];
}

// the hat wall: twelve pegs, four rows of three, caps nosed down and out
// (bill runs +x on the model; ry -PI turns it out the front, rx tips it)
function hatWall() {
  const tints = [0x315c43, 0x365f85, 0xd8d1bf, 0x2f302f];
  const out = [];
  for (const row of HAT_ROWS) {
    for (const x of [-0.345, -0.115, 0.115, 0.345]) {
      const index = out.length + 1;
      out.push({
        x, y: row + 0.030, z: 0.034,
        ry: (out.length % 2) * 0.08 - 0.04,
        rx: -0.16,
        socketName: `HAT_PEG_SLOT_${String(index).padStart(2, '0')}`,
        tint: tints[out.length % tints.length],
      });
    }
  }
  return out;
}

// Gloves, STOOD UP and fronted, eight to a shelf in two staggered ranks (a
// single rank of eight would interpenetrate on a 1.0 m module; two ranks of
// four at double pitch keep every glove clear and the shelf reads FULLER).
function gloveModule(skuId) {
  const h = HOME.get(skuId);
  return authoredAccessoryProducts(skuId, h ? h.lane : 0).map((slot, i) => ({
    ...slot, ry: (i % 2) * 0.08 - 0.04,
  }));
}

// sock rolls fronted straight on the module shelves (no basket: the slatwall
// shelves are 0.26 deep and the rolls read best in a neat row)
function sockModule(skuId) {
  const h = HOME.get(skuId);
  return authoredAccessoryProducts(skuId, h ? h.lane : 0).map((slot, i) => ({
    ...slot, ry: (i % 2) * 0.06 - 0.03,
  }));
}

// umbrellas, stood in a barrel at the end of the accessory run
function barrel(n = 8) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: 1.42 + Math.sin(a) * 0.09, y: 0.25, z: 0.33 + Math.cos(a) * 0.09, lean: Math.sin(a) * 0.12 });
  }
  return out;
}

// pairs on the shoe wall: two 1.20 m modules at x ±0.60, two pair positions
// per angled display board, three boards a module
function shoeWall() {
  const out = [];
  for (const [moduleIndex, m] of [-0.6, 0.6].entries()) {
    const tag = moduleIndex ? 'R' : 'L';
    for (const [boxIndex, x] of [-0.40, -0.065, 0.28].entries()) {
      out.push({
        x: m + x, y: 0.256, z: 0, boxed: true,
        socketName: moduleSocket('shoe1', tag, `SHOEBOX_SLOT_${String(boxIndex + 1).padStart(2, '0')}`),
      });
    }
    const displayed = [
      { localIndex: 1, x: -0.28, row: 0 },
      { localIndex: 4, x: 0.28, row: 1 },
      { localIndex: 5, x: -0.28, row: 2 },
    ];
    for (const pose of displayed) {
      out.push({
        x: m + pose.x, y: SHOE_ROWS[pose.row] + 0.014, z: 0.03,
        rx: -0.18, ry: pose.x > 0 ? 0.08 : -0.08,
        socketName: moduleSocket('shoe1', tag, `SHOE_SLOT_${String(pose.localIndex).padStart(2, '0')}`),
      });
    }
  }
  return out;
}

// bags, stood on the display platform, leaned onto its rear rail
function bagPlinth(n = 5) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: -0.60 + i * 0.30, y: 0.12, z: 0.01,
      ry: -0.16 + i * 0.08, lean: -0.055,
      socketName: `BAG_SLOT_${String(i + 1).padStart(2, '0')}`,
    });
  }
  return out;
}

function rangefinderCase() {
  const ys = [0.77 + 0.152, 0.77 + 0.372];
  return ys.flatMap((y, row) => [-0.18, 0, 0.18].map((x, col) => ({
    x, y, z: row ? 0.020 : 0.050,
    // The authored optic runs along local X. Turn its objective toward the
    // player instead of presenting six anonymous charcoal side panels.
    ry: -Math.PI / 2 + (col - 1) * 0.06,
    socketName: `RF_SLOT_${String(row * 3 + col + 1).padStart(2, '0')}`,
  })));
}

// --- the table ------------------------------------------------------------------------------
// One entry per line for sale. If it is not here it does not go on a shelf, and the sim will not
// let you put it on one.
const BUILD = {
  // clubs — full length in the Sheet-03 racks: drivers own one two-module
  // rack; irons + wedges the other (wedge2 stands in its rear rank);
  // putters head-down in the groove modules
  // lengths keep every head VISIBLE above the comb: an iron blade is thin, so
  // a 0.95 shaft seats it level with the rail and it vanishes into the teeth
  driver1: (id) => clubRack(id, 1.05),
  driver2: (id) => clubRack(id, 1.05),
  driver3: (id) => clubRack(id, 1.05),
  irons1: (id) => clubRack(id, 1.04),
  irons2: (id) => clubRack(id, 1.04),
  wedge1: (id) => clubRack(id, 1.03),
  wedge2: (id) => clubRack(id, 1.03),
  putter1: putterRack,
  putter2: putterRack,

  // the ball wall: one ball_shelf module per line, five boxes to a board
  balls1: ballModule,
  balls2: ballModule,
  balls3: ballModule,

  // the accessory slatwall run: carded tees and markers use real hooks plus
  // shelf landings; towels fill the east module. Premium optics live in their
  // dedicated Asset 30 case on the entrance feature table.
  tees1: (id) => accessoryHybrid(id, 0, -0.105),
  marker1: (id) => accessoryHybrid(id, 1, -0.090),
  towel1: (id) => authoredAccessoryProducts(id, 2),
  range2: rangefinderCase,
  umb1: () => barrel(8),

  // apparel
  polo1: tableApparel,
  polo2: apparelDisplay,
  jacket2: apparelWall,
  cap1: hatWall,
  glove1: gloveModule,
  sock1: sockModule,
  shoe1: shoeWall,

  // bags
  bag1: () => bagPlinth(5),

  // authored grab-and-go sockets: fourteen bottles and ten snack pouches
  water1: () => SNACKRACK_AUTHORED_SLOTS.water1,
  snack1: () => SNACKRACK_AUTHORED_SLOTS.snack1,
};

const CACHE = new Map();

// every place a unit of this line can stand, in fill order
export function slotsFor(skuId) {
  if (CACHE.has(skuId)) return CACHE.get(skuId);
  const build = BUILD[skuId];
  const slots = build ? build(skuId) : [];
  CACHE.set(skuId, slots);
  return slots;
}

// how many of this line the shop can physically display. THE definition.
export function capacityOf(skuId) {
  return slotsFor(skuId).length;
}

// Renderer/UI contract for empty, partial and full shelves. Invalid or corrupt
// quantities are clamped once here, so neither view can invent stock or address
// a slot that does not physically exist.
export function visibleSlotsFor(skuId, quantity) {
  const slots = slotsFor(skuId);
  const count = Math.max(0, Math.min(slots.length, Math.floor(Number(quantity) || 0)));
  return slots.slice(0, count);
}

export function stockPresentationState(skuId, quantity) {
  const capacity = capacityOf(skuId);
  const count = visibleSlotsFor(skuId, quantity).length;
  return {
    count,
    capacity,
    state: count === 0 ? 'empty' : count === capacity ? 'full' : 'partial',
  };
}

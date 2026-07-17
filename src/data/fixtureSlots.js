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
const ACC_SHELF_TOPS = [0.562, 0.962, 1.362];   // accessory_slatwall bracket shelves
const BALL_BOARD_TOPS = [0.317, 0.657, 0.997];  // ball_shelf boards
const SHOE_ROWS = [0.62, 1.02, 1.42];      // shoe_wall display boards (angled -0.18)
const HAT_ROWS = [0.62, 1.02, 1.42, 1.82]; // hat_wall peg rows
const CLUB_SLOT_XS = Array.from({ length: 9 }, (_, k) => (k - 4) * 0.1125); // club_rack comb

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
  const front = [];
  for (const m of [-0.6, 0.6]) {
    for (const lx of CLUB_SLOT_XS) {
      front.push({
        x: m + lx, y: 0.055 + len, z: 0.075,
        len, headUp: true, lean: 0,
        ry: 0.05 - (front.length % 2) * 0.10,
      });
    }
  }
  if (lane <= 2) return front.slice(lane * 6, lane * 6 + 6);
  // the fourth lane stands in the rear rank (three per module, alternating)
  const rear = [];
  for (const m of [-0.6, 0.6]) {
    for (const k of [2, 4, 6]) {
      rear.push({
        x: m + CLUB_SLOT_XS[k], y: 0.055 + len, z: -0.075,
        len, headUp: true, lean: 0, ry: 0.05,
      });
    }
  }
  return rear;
}

// the putter rack: two 1.00 m groove modules at x ±0.53, heads down in the
// felt grooves (the game's native head-at-slot pose), grips on the rail
function putterRack(skuId) {
  const h = HOME.get(skuId);
  const m = (h && h.lane === 1) ? 0.53 : -0.53;
  return Array.from({ length: 6 }, (_, k) => ({
    x: m + (k - 2.5) * 0.15,
    y: 0.185,
    z: 0.045,
    lean: (k % 2) * 0.04 - 0.02,
    len: 0.80,
    ry: 0.12 + (k % 2) * 0.10,
  }));
}

// dozen-boxes fronted on a ball_shelf module — one module per line
function ballModule(skuId) {
  const h = HOME.get(skuId);
  const m = ACC_MODULES[h ? h.lane : 0];
  const out = [];
  for (const top of BALL_BOARD_TOPS) {
    for (let c = 0; c < 5; c++) {
      out.push({ x: m + (c - 2) * 0.175, y: top + 0.0605, z: 0.09 });
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

// folded on the table top, then hung from its rail behind
function tableApparel(skuId) {
  const cx = laneX(skuId, 1.8);
  const out = [];
  for (let i = 0; i < 9; i++) {              // three stacks of three, folded
    const col = Math.floor(i / 3);
    out.push({
      x: cx + (col - 1) * 0.28,
      y: 1.005 + (i % 3) * 0.055,
      z: -0.05,
      ry: (i % 2) * 0.09 - 0.045,
      folded: true,
    });
  }
  for (let j = 0; j < 3; j++) {              // and three on the hang rail
    out.push({ x: cx + (j - 1) * 0.32, y: 1.68, z: -0.62, ry: 0.06 + (j % 2) * 0.08 });
  }
  return out;
}

// hangers on the apparel wall's two rods: four to a module, hook on the metal
// (the kit authors APPAREL_HANGER_SLOT_01..04 at local x ±0.39/±0.13, rod y
// 1.68 — module centres sit at ±0.55, same bar height the old rail used)
function railHang(skuId, n = 8) {
  const xs = [-0.94, -0.68, -0.42, -0.16, 0.16, 0.42, 0.68, 0.94];
  return xs.slice(0, n).map((x, i) => ({ x, y: 1.68, z: 0, ry: 0.06 + (i % 2) * 0.08 }));
}

// the hat wall: twelve pegs, four rows of three, caps nosed down and out
// (bill runs +x on the model; ry -PI turns it out the front, rx tips it)
function hatWall() {
  const out = [];
  for (const row of HAT_ROWS) {
    for (const x of [-0.30, 0, 0.30]) {
      out.push({
        x, y: row + 0.035, z: 0.175,
        ry: -Math.PI + (out.length % 2) * 0.10 - 0.05,
        rx: -0.30,
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
  const m = ACC_MODULES[h ? h.lane : 0];
  const out = [];
  for (const top of ACC_SHELF_TOPS) {
    for (let c = 0; c < 8; c++) {
      const rank = Math.floor(c / 4);        // front four, then the rank behind
      out.push({
        x: m + ((c % 4) - 1.5) * 0.23 + rank * 0.115,
        y: top + 0.10,
        z: 0.075 - rank * 0.095,
        ry: (c % 2) * 0.10 - 0.05,
      });
    }
  }
  return out;
}

// sock rolls fronted straight on the module shelves (no basket: the slatwall
// shelves are 0.26 deep and the rolls read best in a neat row)
function sockModule(skuId) {
  const h = HOME.get(skuId);
  const m = ACC_MODULES[h ? h.lane : 0];
  const out = [];
  for (const top of ACC_SHELF_TOPS) {
    for (let c = 0; c < 8; c++) {
      out.push({ x: m + (c - 3.5) * 0.11, y: top + 0.033, z: 0.03 });
    }
  }
  return out;
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
  for (const row of SHOE_ROWS) {
    for (const x of [-0.88, -0.32, 0.32, 0.88]) {
      out.push({ x, y: row + 0.054, z: 0.03 });
    }
  }
  return out;
}

// bags, stood on the display platform, leaned onto its rear rail
function bagPlinth(n = 4) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: -0.57 + i * 0.38, y: 0.12, z: 0.01, ry: -0.18 + i * 0.12, lean: -0.075 });
  }
  return out;
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

  // the accessory slatwall run: tees on the west module; markers and towels
  // split the middle one; rangefinders pair up on the east module's shelves
  tees1: () => accShelf(4, 0.115, 0.05, { mx: -1.0 }),
  marker1: () => accShelf(4, 0.112, 0.05, { mx: 0, ox: -0.22 }),
  towel1: () => accShelf(4, 0.105, 0.05, { mx: 0, ox: 0.2575 }),
  range2: () => accShelf(2, 0.28, 0.001, { mx: 1.0, ry: -0.4 }),
  umb1: () => barrel(8),

  // apparel
  polo1: tableApparel,
  polo2: tableApparel,
  jacket2: (id) => railHang(id, 8),
  cap1: hatWall,
  glove1: gloveModule,
  sock1: sockModule,
  shoe1: shoeWall,

  // bags
  bag1: () => bagPlinth(4),
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

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

const SHELF_BOARDS = [0.5, 1.05, 1.6];   // wall unit
const SHOE_BOARDS = [0.35, 0.85, 1.35];  // the lit shoe wall

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

// boxes/cartons fronted on the boards of a wall unit
function shelfGrid(skuId, { cols, pitch, lift, z = 0.10, boards = SHELF_BOARDS, usable = 2.8 }) {
  const cx = laneX(skuId, usable);
  const out = [];
  for (const y of boards) {
    for (let c = 0; c < cols; c++) {
      out.push({ x: cx + (c - (cols - 1) / 2) * pitch, y: y + lift, z });
    }
  }
  return out;
}

// a club bay: two racks, three clubs to a rack, each leaning on the one before it
function clubBay(skuId) {
  const h = HOME.get(skuId);
  const lanes = Math.max(1, h ? h.lanes : 1);
  const lw = 2.5 / lanes;
  const cx = -1.25 + lw * ((h ? h.lane : 0) + 0.5);
  const out = [];
  for (let i = 0; i < 6; i++) {
    const row = Math.floor(i / 3);
    const k = i % 3;
    const y = row === 0 ? 0.18 : 1.32;
    const len = row === 0 ? 1.06 : 0.82;   // the upper rack is shallower
    out.push({
      x: cx + (k - 1) * Math.min(0.11, lw / 3.4),
      y,
      z: 0.10 - k * 0.03,
      lean: 0.14 + k * 0.03,
      len,
      ry: 0.30 + (k % 2) * 0.18,           // fan the faces slightly
    });
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

// an outerwear rail: hangers, spaced so the garments nest but do not merge
function railHang(skuId, n = 8, step = 0.28) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: -((n - 1) / 2) * step + i * step, y: 1.68, z: 0, ry: 0.06 + (i % 2) * 0.08 });
  }
  return out;
}

// the hat tree: two tiers, bills pointing out
function hatTree(n = 12, per = 6) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const tier = Math.floor(i / per);
    const a = ((i % per) / per) * Math.PI * 2 + tier * 0.5;
    out.push({ x: Math.sin(a) * 0.30, y: 1.05 + tier * 0.38, z: Math.cos(a) * 0.30, ry: a });
  }
  return out;
}

// Gloves, STOOD UP and fronted, eight to a board.
//
// They used to be laid flat (rotation.x = -PI/2), and a glove lying flat on a shelf board at chest
// height is edge-on to a standing player: twelve of them rendered as twelve white slivers and the
// shelf read as EMPTY at full capacity, which fails "full must look full" exactly as badly as
// drawing too few would. A shop stands its gloves up, because a shop wants you to see them.
function gloveFan(skuId) {
  const cx = laneX(skuId, 2.8);
  const out = [];
  for (const y of SHELF_BOARDS) {
    for (let c = 0; c < 8; c++) {
      out.push({ x: cx + (c - 3.5) * 0.155, y: y + 0.10, z: 0.06, ry: (c % 2) * 0.10 - 0.05 });
    }
  }
  return out;
}

// socks, rolled — a wicker basket on each board, eight rolls to a basket
function sockBasket(skuId) {
  const cx = laneX(skuId, 2.8);
  const out = [];
  for (const y of SHELF_BOARDS) {
    for (let i = 0; i < 8; i++) {
      out.push({
        x: cx + ((i % 4) - 1.5) * 0.085,
        y: y + 0.14 + Math.floor(i / 4) * 0.055,
        z: 0.10,
        base: y,           // the board this basket stands on
      });
    }
  }
  return out;
}

// towels, rolled and stacked on the boards
function towelRolls(skuId) {
  const cx = laneX(skuId, 2.8);
  const out = [];
  for (const y of SHELF_BOARDS) {
    for (let c = 0; c < 4; c++) out.push({ x: cx + (c - 1.5) * 0.11, y: y + 0.08, z: 0.10 });
  }
  return out;
}

// rangefinders on little risers — two to a board, because they are 279 dollars each
function riser(skuId) {
  const cx = laneX(skuId, 2.8);
  const out = [];
  for (const y of SHELF_BOARDS) {
    for (const s of [-1, 1]) out.push({ x: cx + s * 0.11, y: y + 0.085, z: 0.10, ry: -0.4 });
  }
  return out;
}

// umbrellas, stood in a barrel at the end of the run
function barrel(skuId, n = 8) {
  const cx = laneX(skuId, 2.8);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: cx + Math.sin(a) * 0.09, y: 0.25, z: 0.30 + Math.cos(a) * 0.09, lean: Math.sin(a) * 0.12 });
  }
  return out;
}

// pairs on the lit shoe wall
function shoeBoards(n = 12, per = 4) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: -1.05 + (i % per) * 0.70,
      y: SHOE_BOARDS[Math.floor(i / per) % 3] + 0.055,
      z: 0.06,
    });
  }
  return out;
}

// bags, stood on their platforms
function bagPlinth(n = 4) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: -0.90 + i * 0.60, y: 0.12, z: -0.10, ry: -0.5 + i * 0.34, lean: -0.10 });
  }
  return out;
}

// --- the table ------------------------------------------------------------------------------
// One entry per line for sale. If it is not here it does not go on a shelf, and the sim will not
// let you put it on one.
const BUILD = {
  // clubs — six to a bay, whichever bay they live on
  driver1: clubBay, driver2: clubBay, driver3: clubBay,
  irons1: clubBay, irons2: clubBay,
  putter1: clubBay, putter2: clubBay,
  wedge1: clubBay, wedge2: clubBay,

  // the ball wall: five fronted boxes to a board, three boards, three lines side by side
  balls1: (id) => shelfGrid(id, { cols: 5, pitch: 0.175, lift: 0.062 }),
  balls2: (id) => shelfGrid(id, { cols: 5, pitch: 0.175, lift: 0.062 }),
  balls3: (id) => shelfGrid(id, { cols: 5, pitch: 0.175, lift: 0.062 }),

  // cartoned smalls
  tees1: (id) => shelfGrid(id, { cols: 4, pitch: 0.135, lift: 0.085, z: 0.08 }),
  marker1: (id) => shelfGrid(id, { cols: 4, pitch: 0.135, lift: 0.085, z: 0.08 }),
  towel1: towelRolls,
  range2: riser,
  umb1: (id) => barrel(id, 8),

  // apparel
  polo1: tableApparel,
  polo2: tableApparel,
  jacket2: (id) => railHang(id, 8),
  cap1: () => hatTree(12),
  glove1: gloveFan,
  sock1: sockBasket,
  shoe1: () => shoeBoards(12),

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

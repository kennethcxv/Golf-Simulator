// THE REAL PRO SHOP FLOOR PLAN — the clubhouse interior is a believable golf
// retail space designed as data (src/data/shopLayout.js) BEFORE anything is
// placed in the scene: zones, fixtures, counter, office, stockroom, doors.
// These tests pin the retail-design invariants (nothing blocks the entrance,
// every fixture stocks real SKUs, required zones exist) and the save
// migration from the old 14×10 room's 7×5 grime grid to the new plan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { RENO, ensureShopReno } from '../src/sim/shop.js';
import {
  SHELL, INTERIOR, FIXTURES, COUNTER, OFFICE, STOCKROOM, DOOR_MAIN,
  DOOR_CLEARWAY, BACKDOOR_CLEARWAY, queueSlot, fixtureRect, FIXTURE_HALF,
} from '../src/data/shopLayout.js';
import { SHOP_CATALOG, DECOR_SPOTS, skuById, RETAIL_CATS, SHELF_CAP } from '../src/data/shopItems.js';
import { placeOrder } from '../src/sim/shop.js';

const inRect = (p, r) => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
const inInterior = (p, margin = 0) =>
  Math.abs(p.x) <= INTERIOR.w / 2 - margin && Math.abs(p.z) <= INTERIOR.d / 2 - margin;

test('the floor plan and the sim grime grid describe the same room', () => {
  assert.equal(RENO.room.w, INTERIOR.w, 'RENO.room.w matches the interior width');
  assert.equal(RENO.room.d, INTERIOR.d, 'RENO.room.d matches the interior depth');
  const cw = INTERIOR.w / RENO.grid.w;
  const cd = INTERIOR.d / RENO.grid.h;
  assert.ok(cw >= 1.5 && cw <= 2.5, `grime cells stay vacuum-pass sized (${cw.toFixed(2)} yd wide)`);
  assert.ok(cd >= 1.5 && cd <= 2.5, `grime cells stay vacuum-pass sized (${cd.toFixed(2)} yd deep)`);
  assert.ok(INTERIOR.w === SHELL.w - 2 * SHELL.wallT, 'interior width = shell minus two walls');
  assert.ok(INTERIOR.d === SHELL.d - 2 * SHELL.wallT, 'interior depth = shell minus two walls');
});

test('every fixture stocks real catalog SKUs and sits inside the building', () => {
  assert.ok(FIXTURES.length >= 10, `a real store needs fixtures (${FIXTURES.length})`);
  const stockBounds = STOCKROOM.bounds;
  for (const f of FIXTURES) {
    assert.ok(inInterior(f, 0.2), `${f.id} sits inside the walls`);
    for (const id of f.skus) {
      const sku = skuById(id);
      assert.ok(sku, `${f.id} stocks a real SKU (${id})`);
      if (f.kind !== 'backshelf') {
        assert.ok(RETAIL_CATS.has(sku.cat), `${f.id}'s ${id} is retail-sellable`);
      }
    }
    if (f.kind === 'backshelf') {
      assert.ok(inRect(f, stockBounds), `${f.id} lives in the stockroom`);
    } else {
      assert.ok(!inRect(f, stockBounds), `${f.id} does not leak into the stockroom`);
    }
  }
  // no SKU is orphaned: every retail catalog line has a fixture facing
  const faced = new Set(FIXTURES.flatMap((f) => f.skus));
  for (const sku of SHOP_CATALOG) {
    if (RETAIL_CATS.has(sku.cat) && sku.tier <= 3) {
      assert.ok(faced.has(sku.id), `${sku.id} has a home fixture`);
    }
  }
});

test('the entrance clearway stays clear: no fixture, clutter, or queue slot blocks the door', () => {
  for (const f of FIXTURES) {
    assert.ok(!inRect(f, DOOR_CLEARWAY), `${f.id} stays out of the doorway`);
  }
  const state = newGame('relaxed', 42);
  for (const c of state.shop.reno.clutter) {
    assert.ok(!inRect(c, DOOR_CLEARWAY), `clutter at (${c.x},${c.z}) stays out of the doorway`);
  }
  for (let i = 0; i < 6; i++) {
    assert.ok(!inRect(queueSlot(i), DOOR_CLEARWAY), `queue slot ${i} stays out of the doorway`);
  }
  assert.ok(!inRect(COUNTER, DOOR_CLEARWAY), 'the counter is not in the doorway');
  assert.ok(Math.abs(DOOR_MAIN.x - (DOOR_CLEARWAY.minX + DOOR_CLEARWAY.maxX) / 2) < 1,
    'the clearway is actually in front of the main door');
});

// fixtureRect now lives in shopLayout.js: the collider, these tests and the placement
// validator must all read ONE definition, or a fixture is one size to the physics and
// another to the rules.

test('the receiving doorway stays walkable: no fixture collider in the back-door clearway', () => {
  for (const f of FIXTURES) {
    const r = fixtureRect(f);
    if (f.short) assert.ok(FIXTURE_HALF[f.kind], `${f.id} short variant still has extents`);
    const overlaps = r.maxX > BACKDOOR_CLEARWAY.minX && r.minX < BACKDOOR_CLEARWAY.maxX
      && r.maxZ > BACKDOOR_CLEARWAY.minZ && r.minZ < BACKDOOR_CLEARWAY.maxZ;
    assert.ok(!overlaps, `${f.id} keeps clear of the receiving doorway`);
  }
});

test('fresh and migrated restoration clutter stays out of the operational stockroom', () => {
  const isInStockroom = (pile) => pile.x >= STOCKROOM.bounds.minX
    && pile.x <= STOCKROOM.bounds.maxX
    && pile.z >= STOCKROOM.bounds.minZ
    && pile.z <= STOCKROOM.bounds.maxZ;
  const fresh = newGame('relaxed', 42);
  assert.ok(fresh.shop.reno.clutter.every((pile) => !isInStockroom(pile)),
    'fresh clutter cannot obstruct receiving, racks, worktable, or recycling');

  const legacyRaw = JSON.parse(serialize(fresh));
  delete legacyRaw.shop.reno.layoutVersion;
  legacyRaw.shop.reno.clutter[6] = { x: 6.4, z: -4.6, ry: 0, cleared: false };
  legacyRaw.shop.reno.clutter[7] = { x: 7.6, z: 1.3, ry: 0, cleared: true };
  const migrated = deserialize(JSON.stringify(legacyRaw));
  assert.ok(migrated.shop.reno.clutter.every((pile) => !isInStockroom(pile)),
    'legacy stockroom piles relocate on load');
  assert.equal(migrated.shop.reno.clutter[7].cleared, true,
    'relocation preserves whether a legacy pile was already hauled away');
});

// touching runs are legal (racks butt into one wall unit); EPS forgives the
// floating-point dust on exact-touch sums like (-0.2 + 1.5) vs (2.8 - 1.5)
const EPS = 1e-6;

test('fixtures never overlap each other (real-world clearances hold)', () => {
  for (let i = 0; i < FIXTURES.length; i++) {
    for (let j = i + 1; j < FIXTURES.length; j++) {
      const a = fixtureRect(FIXTURES[i]);
      const b = fixtureRect(FIXTURES[j]);
      const overlap = a.maxX > b.minX + EPS && a.minX < b.maxX - EPS
        && a.maxZ > b.minZ + EPS && a.minZ < b.maxZ - EPS;
      assert.ok(!overlap, `${FIXTURES[i].id} does not collide with ${FIXTURES[j].id}`);
    }
  }
});

test('no wedge traps: facing fixtures leave at least 0.75 yd or touch outright', () => {
  // found live 2026-07-13: the walker (body Ø0.68) wedged in the 0.5 yd slot
  // between rail_outer and the feature pedestal — every move blocked. Any
  // pair of fixtures whose footprints face each other must leave a real gap.
  for (let i = 0; i < FIXTURES.length; i++) {
    for (let j = i + 1; j < FIXTURES.length; j++) {
      const a = fixtureRect(FIXTURES[i]);
      const b = fixtureRect(FIXTURES[j]);
      const xOverlap = a.maxX > b.minX + EPS && a.minX < b.maxX - EPS;
      const zOverlap = a.maxZ > b.minZ + EPS && a.minZ < b.maxZ - EPS;
      if (xOverlap && !zOverlap) {
        const gap = Math.max(b.minZ - a.maxZ, a.minZ - b.maxZ);
        assert.ok(gap >= 0.75 - EPS || gap <= 0.05 + EPS, `${FIXTURES[i].id}↔${FIXTURES[j].id} z-gap ${gap.toFixed(2)} yd wedges the walker`);
      }
      if (zOverlap && !xOverlap) {
        const gap = Math.max(b.minX - a.maxX, a.minX - b.maxX);
        assert.ok(gap >= 0.75 - EPS || gap <= 0.05 + EPS, `${FIXTURES[i].id}↔${FIXTURES[j].id} x-gap ${gap.toFixed(2)} yd wedges the walker`);
      }
    }
  }
});

test('the main aisle stays at least 1.2 yd wide from the door to the north wall', () => {
  // walk the entrance axis north; the nearest fixture edge on either side must
  // leave a real aisle (brief: main aisles >= ~1.2 m)
  for (let z = 3.5; z > -4.5; z -= 0.5) {
    let left = -INTERIOR.w / 2;
    let right = INTERIOR.w / 2;
    for (const f of FIXTURES) {
      const r = fixtureRect(f);
      if (z < r.minZ || z > r.maxZ) continue;
      if (r.maxX <= -0.8) left = Math.max(left, r.maxX);
      if (r.minX >= -0.8) right = Math.min(right, r.minX);
    }
    assert.ok(right - left >= 1.2, `aisle at z=${z} is ${(right - left).toFixed(2)} yd`);
  }
});

test('the required retail zones all exist in the plan', () => {
  const zones = new Set(FIXTURES.map((f) => f.zone));
  for (const z of ['clubwall', 'balls', 'accessories', 'apparel', 'bags', 'shoes', 'entrance', 'stockroom']) {
    assert.ok(zones.has(z), `zone "${z}" has at least one fixture`);
  }
  const clubRacks = FIXTURES.filter((f) => f.zone === 'clubwall');
  assert.ok(clubRacks.length >= 3, `clubs get separated presentation (${clubRacks.length} racks)`);
  const apparel = FIXTURES.filter((f) => f.zone === 'apparel');
  assert.ok(apparel.length >= 3, `apparel gets tables/rails/hat display (${apparel.length})`);
  assert.ok(COUNTER && OFFICE && STOCKROOM, 'checkout, office, and stockroom are planned');
  assert.ok(OFFICE.laptop, 'the office plans a laptop position');
  assert.ok(STOCKROOM.padOutside, 'deliveries get a receiving pad outside the back door');
});

test('the new catalog lines (bag, shoes, socks, umbrella) are orderable retail goods', () => {
  const state = newGame('relaxed', 42);
  for (const id of ['bag1', 'shoe1', 'sock1', 'umb1']) {
    const sku = skuById(id);
    assert.ok(sku, `${id} exists`);
    assert.ok(RETAIL_CATS.has(sku.cat), `${id} is sellable retail`);
    assert.ok(SHELF_CAP[sku.cat] > 0, `${id} can take a shelf facing`);
    assert.ok(sku.msrp > sku.cost, `${id} carries a real margin`);
    const res = placeOrder(state, id, 2);
    assert.ok(res.ok, `${id} orders through the existing supplier flow`);
  }
});

test('legacy 7×5 saves migrate: grime resamples to the new grid, dirt level preserved', () => {
  const state = newGame('relaxed', 42);
  const raw = JSON.parse(serialize(state));
  // hand-craft an old-format reno block: 7×5 grid, 5 clutter piles, mixed flags
  const oldGrime = [];
  for (let i = 0; i < 35; i++) oldGrime.push(Math.round((0.3 + 0.5 * (i / 34)) * 1000) / 1000);
  const oldMean = oldGrime.reduce((a, v) => a + v, 0) / 35;
  raw.shop.reno = {
    grime: oldGrime,
    clutter: [
      { x: -5.6, z: 3.4, ry: 0, cleared: true },
      { x: 4.6, z: -3.4, ry: 1, cleared: false },
      { x: 1.6, z: 2.6, ry: 2, cleared: true },
      { x: -3.4, z: -2.8, ry: 3, cleared: false },
      { x: 5.6, z: 3.8, ry: 4, cleared: false },
    ],
    decor: [{ skuId: 'rug1', spot: 0 }],
  };
  const migrated = deserialize(JSON.stringify(raw));
  const reno = migrated.shop.reno;
  assert.equal(reno.grime.length, RENO.grid.w * RENO.grid.h, 'grime regridded to the new plan');
  const newMean = reno.grime.reduce((a, v) => a + v, 0) / reno.grime.length;
  assert.ok(Math.abs(newMean - oldMean) < 0.05,
    `cleaning progress carries over (old ${oldMean.toFixed(3)}, new ${newMean.toFixed(3)})`);
  assert.equal(reno.clutter.filter((c) => c.cleared).length, 2, 'hauled piles stay hauled by index');
  for (const c of reno.clutter) {
    assert.ok(inInterior(c), 'every migrated pile sits inside the NEW room');
  }
  assert.deepEqual(reno.decor, [{ skuId: 'rug1', spot: 0 }], 'placed decor survives (spot counts unchanged)');
});

test('a fully-cleared legacy save migrates fully cleared (no clutter respawns)', () => {
  const state = newGame('relaxed', 42);
  const raw = JSON.parse(serialize(state));
  raw.shop.reno = {
    grime: new Array(35).fill(0),
    clutter: new Array(5).fill(0).map((_, i) => ({ x: i - 2, z: 1, ry: 0, cleared: true })),
    decor: [],
  };
  const migrated = deserialize(JSON.stringify(raw));
  assert.ok(migrated.shop.reno.clutter.length >= 5, 'the new plan may add pile spots');
  assert.ok(migrated.shop.reno.clutter.every((c) => c.cleared),
    'a save that finished hauling does not get new junk dumped on it');
  assert.equal(migrated.shop.reno.grime.reduce((a, v) => a + v, 0), 0, 'a scrubbed floor stays scrubbed');
});

test('decor spots moved with the plan but kept their counts and stayed on real walls', () => {
  const counts = { rug1: 2, plant1: 4, poster1: 3, board1: 2, light1: 2, lounge1: 2 };
  for (const [id, n] of Object.entries(counts)) {
    assert.equal((DECOR_SPOTS[id] || []).length, n, `${id} keeps ${n} spots (save format relies on indexes)`);
    for (const s of DECOR_SPOTS[id]) {
      assert.ok(inInterior(s, -0.1), `${id} spot sits inside the new room`);
      if (s.mount === 'wall') {
        const flushX = Math.abs(Math.abs(s.x) - INTERIOR.w / 2) < 0.15;
        const flushZ = Math.abs(Math.abs(s.z) - INTERIOR.d / 2) < 0.15;
        const flushPartition = Math.abs(s.x - STOCKROOM.bounds.minX) < 0.15;
        assert.ok(flushX || flushZ || flushPartition, `${id} wall spot hangs on a real wall`);
      }
    }
  }
});

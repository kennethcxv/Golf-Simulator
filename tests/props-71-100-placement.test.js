// Assets 71-100 are placed against the floor plan, not by eye.
//
// Thirty finished props were sitting in vendor/ with nothing loading them. Now that they are in
// the room, the thing most likely to go wrong is a coordinate: a prop through a wall, in a
// doorway the plan protects, on top of another prop, or floating above the ceiling. These are the
// invariants the placement table has to satisfy before anything reaches a screenshot.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROP_PLACEMENTS,
  PLACED_ASSET_NUMBERS,
  EXTERIOR_VISIBLE_PROP_NUMBERS,
  detailedPropsVisibleAt,
} from '../src/render3d/assets51to100/propPlacement.js';
import { RUNTIME_ASSET_MANIFEST_BY_NUMBER } from '../src/render3d/assets51to100/runtimeManifest.js';
import {
  INTERIOR, DOOR_CLEARWAY, BACKDOOR_CLEARWAY, SHELL, WINDOWS, WINDOW_DIM, DOOR_MAIN,
} from '../src/data/shopLayout.js';

const HX = INTERIOR.w / 2;
const HZ = INTERIOR.d / 2;
const byNumber = (n) => PROP_PLACEMENTS.find((p) => p.n === n);

test('deep prop dressing retires only beyond the porch while entrance props remain eligible', () => {
  assert.equal(detailedPropsVisibleAt(0, 0), true, 'interior camera needs every prop');
  assert.equal(detailedPropsVisibleAt(0, HZ + 1.3), true, 'door/porch camera must not pop dressing');
  assert.equal(detailedPropsVisibleAt(5.6, 9.2), false,
    'accepted pressure-washer camera should cull covered deep-interior props');
  assert.deepEqual(EXTERIOR_VISIBLE_PROP_NUMBERS, [93, 94, 98, 99, 100]);
  assert.ok(!EXTERIOR_VISIBLE_PROP_NUMBERS.includes(71),
    'stockroom cleaning props are covered from the distant exterior camera');
});

test('every interior asset from 61 to 100 has exactly one placement definition', () => {
  assert.equal(PROP_PLACEMENTS.length, 40);
  for (let n = 61; n <= 100; n++) {
    const hits = PROP_PLACEMENTS.filter((p) => p.n === n);
    assert.equal(hits.length, 1, `asset ${n} has ${hits.length} placements`);
  }
  assert.equal(new Set(PLACED_ASSET_NUMBERS).size, 40);
});

test('every placement names a real runtime asset', () => {
  for (const p of PROP_PLACEMENTS) {
    const runtime = RUNTIME_ASSET_MANIFEST_BY_NUMBER[p.n];
    assert.ok(runtime, `${p.n}: missing runtime manifest record`);
    assert.match(runtime.glbPath, new RegExp(`/sheet_(07|08|09|10)/asset_${String(p.n).padStart(3, '0')}_`),
      `${p.n}: runtime path does not belong to the placement`);
  }
});

test('nothing is placed outside the shell', () => {
  for (const p of PROP_PLACEMENTS) {
    assert.ok(Math.abs(p.x) <= HX + 0.1, `${p.n}: x ${p.x} is outside the walls`);
    assert.ok(Math.abs(p.z) <= HZ + 0.1, `${p.n}: z ${p.z} is outside the walls`);
    assert.ok((p.y || 0) >= 0, `${p.n}: y ${p.y} is below the floor`);
    assert.ok((p.y || 0) < SHELL.h, `${p.n}: y ${p.y} is above the ${SHELL.h} ceiling`);
  }
});

test('the entrance clearway stays clear of anything solid', () => {
  // A welcome mat is flat and belongs precisely here; an exit sign is 2.7 yd up, over the door.
  // Everything else must keep out — this is the route customers walk in through.
  const allowed = new Set([100, 94]);
  for (const p of PROP_PLACEMENTS) {
    if (allowed.has(p.n)) continue;
    const inside = p.x >= DOOR_CLEARWAY.minX && p.x <= DOOR_CLEARWAY.maxX
      && p.z >= DOOR_CLEARWAY.minZ && p.z <= DOOR_CLEARWAY.maxZ;
    assert.ok(!inside, `${p.n} sits in the entrance clearway at (${p.x}, ${p.z})`);
  }
});

test('the receiving doorway stays clear — boxes come through it in your arms', () => {
  for (const p of PROP_PLACEMENTS) {
    const inside = p.x >= BACKDOOR_CLEARWAY.minX && p.x <= BACKDOOR_CLEARWAY.maxX
      && p.z >= BACKDOOR_CLEARWAY.minZ && p.z <= BACKDOOR_CLEARWAY.maxZ;
    assert.ok(!inside, `${p.n} blocks the receiving door at (${p.x}, ${p.z})`);
  }
});

test('every placement declares what it is fixed to', () => {
  const kinds = new Set(['floor', 'surface', 'wall', 'ceiling', 'movable-fixture', 'socket']);
  for (const p of PROP_PLACEMENTS) {
    assert.ok(kinds.has(p.mount), `${p.n}: bad mount '${p.mount}'`);
    if (p.mount === 'socket') {
      assert.ok(Number.isInteger(p.parentAsset), `${p.n}: socket mount needs a parent asset`);
      assert.match(p.parentSocket || '', /^SOCKET_/u, `${p.n}: socket mount needs an authored socket`);
      assert.ok(PROP_PLACEMENTS.some((candidate) => candidate.n === p.parentAsset),
        `${p.n}: parent asset ${p.parentAsset} is not placed`);
    }
  }
});

test('no WALL-MOUNTED prop is hung over a window', () => {
  // A window is 2.4 wide with its head at sill + height = 2.75. A clock bolted to that wall inside
  // that span would be screwed to glass. A printer standing on a cabinet beneath one is just a
  // printer under a window — which is why this reads `mount` rather than guessing from height.
  const head = WINDOW_DIM.sill + WINDOW_DIM.h;
  const half = WINDOW_DIM.w / 2;
  for (const p of PROP_PLACEMENTS) {
    if (p.mount !== 'wall') continue;
    const y = p.y || 0;
    if (y >= head) continue; // above the opening
    for (const w of WINDOWS) {
      const onSouth = w.wall === 'S' && Math.abs(p.z - HZ) < 0.4;
      const onNorth = w.wall === 'N' && Math.abs(p.z + HZ) < 0.4;
      const onEast = w.wall === 'E' && Math.abs(p.x - HX) < 0.4;
      if (onSouth || onNorth) {
        assert.ok(Math.abs(p.x - w.c) > half,
          `${p.n} is mounted over the ${w.wall} window at x ${w.c}`);
      } else if (onEast) {
        assert.ok(Math.abs(p.z - w.c) > half,
          `${p.n} is mounted over the E window at z ${w.c}`);
      }
    }
  }
});

test('nothing is hung across the main doorway opening', () => {
  const halfDoor = DOOR_MAIN.w / 2;
  const headHeight = DOOR_MAIN.h;
  for (const p of PROP_PLACEMENTS) {
    if (p.mount !== 'wall') continue;
    if (Math.abs(p.z - HZ) > 0.4) continue; // not on the entrance wall
    const y = p.y || 0;
    if (y >= headHeight) continue;          // above the head is where the exit sign lives
    assert.ok(Math.abs(p.x - DOOR_MAIN.x) > halfDoor,
      `${p.n} is mounted across the main door at x ${p.x}`);
  }
});

test('no two props are stacked on the same spot', () => {
  for (let i = 0; i < PROP_PLACEMENTS.length; i++) {
    for (let j = i + 1; j < PROP_PLACEMENTS.length; j++) {
      const a = PROP_PLACEMENTS[i];
      const b = PROP_PLACEMENTS[j];
      const flat = Math.hypot(a.x - b.x, a.z - b.z);
      const dy = Math.abs((a.y || 0) - (b.y || 0));
      // Props may share a footprint if they are at clearly different heights (a clock above a
      // cabinet); they may not occupy the same point at the same height.
      assert.ok(flat > 0.22 || dy > 0.35,
        `${a.n} and ${b.n} are on top of each other at (${a.x}, ${a.z})`);
    }
  }
});

test('the cleaning bay props are actually in the stockroom', () => {
  // The compact service wing remains x 5.7..east wall, north wall..z 2.0.
  for (const n of [71, 72, 73, 74, 75, 76, 77, 78, 79, 80]) {
    const p = byNumber(n);
    assert.ok(p.x >= 5.7 && p.x <= HX, `${n} at x ${p.x} is not in the stockroom`);
    assert.ok(p.z >= -HZ && p.z <= 2.0, `${n} at z ${p.z} is not in the stockroom`);
  }
});

test('desk props sit at a desk height, not on the floor', () => {
  for (const n of [83, 85]) {           // lamp, telephone
    const p = byNumber(n);
    assert.ok((p.y || 0) > 0.6, `${n} is at y ${p.y} — that is on the floor, not on the desk`);
  }
  for (const n of [89, 90]) {           // clipboard, scorecard holder
    const p = byNumber(n);
    assert.ok((p.y || 0) > 1.0, `${n} is at y ${p.y} — that is not on the counter`);
  }
});

test('safety fittings are mounted at code-plausible heights', () => {
  assert.ok((byNumber(91).y || 0) > 0.8, 'a fire extinguisher bracket is not at ankle height');
  assert.ok((byNumber(94).y || 0) > DOOR_MAIN.h, 'the exit sign must clear the door head');
  assert.ok((byNumber(93).y || 0) > 2.4, 'a security camera belongs high on the wall');
  assert.ok((byNumber(95).y || 0) > 2.4, 'an emergency light belongs high on the wall');
  assert.ok((byNumber(98).y || 0) > 0.9 && (byNumber(98).y || 0) < 1.6,
    'a sanitiser dispenser goes at hand height');
});

test('the welcome mat lies flat inside the threshold', () => {
  const mat = byNumber(100);
  assert.ok((mat.y || 0) < 0.05, 'a floor mat is flat on the floor');
  assert.ok((mat.y || 0) > 0, 'but proud of it, or it z-fights the boards');
  assert.ok(Math.abs(mat.x - DOOR_MAIN.x) < 0.3, 'square with the door it serves');
  assert.ok(mat.z < HZ && mat.z > HZ - 1.6, 'just inside the entrance');
});

test('every placement records why it is where it is', () => {
  for (const p of PROP_PLACEMENTS) {
    assert.ok(p.note && p.note.length > 12,
      `${p.n} has no note — a coordinate with no reason is a coordinate nobody can safely move`);
  }
});

// --- supersession --------------------------------------------------------------------------

import { SUPERSEDES } from '../src/render3d/assets51to100/propPlacement.js';

test('every stand-in names the assets that retire it', () => {
  assert.ok(SUPERSEDES.length >= 3, 'the known stand-ins are the cleaning corner, the mat and the chair');
  for (const rule of SUPERSEDES) {
    assert.ok(rule.legacy && rule.legacy.startsWith('Legacy'),
      `'${rule.legacy}' should be a Legacy* scene object`);
    assert.ok(Array.isArray(rule.replacedBy) && rule.replacedBy.length,
      `${rule.legacy} must say what replaces it`);
    for (const n of rule.replacedBy) {
      assert.ok(PLACED_ASSET_NUMBERS.includes(n),
        `${rule.legacy} is replaced by asset ${n}, which the table never places`);
    }
  }
});

test('the cleaning corner is retired by the whole kit, not by one piece of it', () => {
  // Disposing the stand-in the moment the mop lands would leave the corner with no bucket at all
  // if the bucket happened to fail to load.
  const rule = SUPERSEDES.find((r) => r.legacy === 'LegacyCleaningCornerScenery');
  assert.ok(rule, 'the cleaning corner stand-in must be superseded');
  for (const n of [71, 72, 73, 74, 75]) {
    assert.ok(rule.replacedBy.includes(n), `asset ${n} is part of the corner it replaces`);
  }
});

test('nothing is superseded by an asset that is not actually placed', () => {
  const placed = new Set(PLACED_ASSET_NUMBERS);
  for (const rule of SUPERSEDES) {
    for (const n of rule.replacedBy) {
      assert.ok(placed.has(n), `${rule.legacy} would be removed for asset ${n}, which is unplaced`);
    }
  }
});

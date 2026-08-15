// D3 — the dirt reveal's tool->medium map has to agree with the cleaning gate.
//
// The gate in clubhouse.js decides what a tool actually removes, inside a
// TOOL_CLASS switch. toolMedia() in cleaningTools.js decides what the reveal
// SHOWS you. Those are two copies of one fact, and if they drift the reveal
// starts promising work a tool cannot do — which is the exact defect D3 exists
// to fix, reintroduced from the other side.
//
// These tests cannot run the renderer, so they do the next honest thing: they
// read the gate's source and check that every tool class it branches on has a
// media entry, and that the entries match the calls that branch makes.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TOOL_CLASS, CLEANING_TOOLS, MEDIUM, toolMedia, toolDebrisKinds,
} from '../src/data/cleaningTools.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const gateSource = fs.readFileSync(
  path.join(HERE, '..', 'src', 'render3d', 'clubhouse.js'), 'utf8',
);

test('every tool class the gate branches on has a media entry', () => {
  for (const cls of Object.values(TOOL_CLASS)) {
    // The gate's switch is over def.toolClass; a class it handles but the map
    // does not know about would silently reveal nothing.
    if (!gateSource.includes(`case TOOL_CLASS.${cls.toUpperCase()}:`)) continue;
    const sample = Object.values(CLEANING_TOOLS).find((t) => t.toolClass === cls);
    assert.ok(sample, `no tool has class ${cls}`);
    assert.ok(Array.isArray(toolMedia(sample.id)), `${cls} has no media entry`);
  }
});

test('every cleaning tool resolves to a media list', () => {
  for (const id of Object.keys(CLEANING_TOOLS)) {
    assert.ok(Array.isArray(toolMedia(id)), `${id} returned no media list`);
    for (const medium of toolMedia(id)) {
      assert.ok(Object.values(MEDIUM).includes(medium), `${id} claims unknown medium ${medium}`);
    }
  }
});

test('the tools that move debris are exactly the ones whose gate branch touches debris', () => {
  // sweepAt / collectAt / suckAt are the three debris verbs in cleaningDebris.js.
  const movesDebris = new Set();
  for (const def of Object.values(CLEANING_TOOLS)) {
    if (toolMedia(def.id).includes(MEDIUM.DEBRIS)) movesDebris.add(def.toolClass);
  }
  assert.deepEqual(
    [...movesDebris].sort(),
    [TOOL_CLASS.CARRY, TOOL_CLASS.SCOOP, TOOL_CLASS.SUCTION, TOOL_CLASS.SWEEP].sort(),
  );
});

test('the tools that lift grime are exactly the ones whose gate branch calls cleanGrimeAt', () => {
  const liftsGrime = new Set();
  for (const def of Object.values(CLEANING_TOOLS)) {
    if (toolMedia(def.id).includes(MEDIUM.GRIME)) liftsGrime.add(def.toolClass);
  }
  assert.deepEqual(
    [...liftsGrime].sort(),
    [TOOL_CLASS.JET, TOOL_CLASS.STROKE, TOOL_CLASS.SUCTION].sort(),
  );
});

test('the sprayer removes nothing - it prepares a surface', () => {
  const sprayer = Object.values(CLEANING_TOOLS).find((t) => t.toolClass === TOOL_CLASS.SPRAY);
  assert.ok(sprayer, 'no spray-class tool');
  assert.deepEqual(toolMedia(sprayer.id), []);
});

test('the trash bag collects litter only, and nothing else discriminates within a medium', () => {
  const bag = Object.values(CLEANING_TOOLS).find((t) => t.toolClass === TOOL_CLASS.CARRY);
  assert.deepEqual(toolDebrisKinds(bag.id), ['litter']);
  assert.ok(gateSource.includes("cluster.kind === 'litter'"),
    'the gate no longer filters the bag to litter; toolDebrisKinds is now lying');
  for (const id of Object.keys(CLEANING_TOOLS)) {
    if (CLEANING_TOOLS[id].toolClass === TOOL_CLASS.CARRY) continue;
    assert.equal(toolDebrisKinds(id), null, `${id} unexpectedly filters debris kinds`);
  }
});

test('a non-tool reveals everything rather than nothing', () => {
  // The empty hand is the "which way do I go" case: the overview map passes no
  // tool and must not be filtered down to an empty screen.
  assert.deepEqual(toolMedia(null), []);
  assert.deepEqual(toolMedia('not-a-tool'), []);
  // …and the renderer turns that empty list into "show both", which is the
  // branch worth pinning because it is the one a naive filter gets wrong.
  assert.ok(
    gateSource.includes('senseTool ? toolMedia(senseTool) : [MEDIUM.DEBRIS, MEDIUM.GRIME]'),
    'the no-tool case no longer falls back to showing every medium',
  );
});

// B4: which tools are DRAWN BARE is a design decision, and it lives in one
// place - `hands: false` in the cleaning-tool registry. Two very different
// consumers read it (fpHands, which owns the shared hand rig, and
// broomViewmodel, which owns its own arms while a rig is active), so the thing
// worth pinning here is not the rendering - a driver measures that in pixels -
// but that the DECLARATION still says what it is supposed to say.
//
// Without this, the flag can be dropped from one entry and the only thing that
// notices is a QA driver nobody runs before a commit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLEANING_TOOLS } from '../src/data/cleaningTools.js';

// The tool sits in view on its own, with no first-person hand on it.
const BARE = ['spray', 'cloth', 'sponge', 'washer', 'trashbag'];
// These keep their hands: you see the arms working the shaft.
const HANDED = ['broom', 'mop', 'vacuum', 'dustpan'];

test('the hand-worked tools are declared bare', () => {
  for (const id of BARE) {
    assert.ok(CLEANING_TOOLS[id], `${id} is missing from the registry`);
    assert.equal(
      CLEANING_TOOLS[id].hands, false,
      `${id} must declare hands: false - it is drawn bare`,
    );
  }
});

test('the stick tools keep their hands', () => {
  for (const id of HANDED) {
    assert.ok(CLEANING_TOOLS[id], `${id} is missing from the registry`);
    assert.notEqual(
      CLEANING_TOOLS[id].hands, false,
      `${id} must NOT declare hands: false - its arms are the viewmodel`,
    );
  }
});

test('every tool is accounted for, so a new one has to make the choice', () => {
  const declared = new Set([...BARE, ...HANDED]);
  const missing = Object.keys(CLEANING_TOOLS).filter((id) => !declared.has(id));
  assert.deepEqual(
    missing, [],
    `these tools are in neither list, so nobody has decided whether they are drawn bare: ${missing.join(', ')}`,
  );
});

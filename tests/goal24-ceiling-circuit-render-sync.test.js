import test from 'node:test';
import assert from 'node:assert/strict';

import { createCeilingCircuitRenderSync } from '../src/render3d/clubhouse/ceilingCircuitRenderSync.js';
import { ceilingCircuitPowered } from '../src/sim/clubhouseRestoration.js';

const campaignState = (restored = false) => ({
  campaign: { enabled: true },
  shop: {
    reno: {
      architecture: {
        components: { ceiling: { restored } },
      },
    },
  },
});

test('render-only circuit sync applies the fresh campaign OFF state exactly once', () => {
  const state = campaignState(false);
  const applied = [];
  const sync = createCeilingCircuitRenderSync({
    state,
    applyPowered(powered) {
      applied.push(powered);
      return true;
    },
  });

  assert.deepEqual(sync.sync(), {
    powered: false,
    changed: true,
    rendererChanged: true,
    sequence: 1,
  });
  const settled = sync.sync();
  assert.deepEqual(settled, {
    powered: false,
    changed: false,
    rendererChanged: false,
    sequence: 1,
  });
  assert.strictEqual(sync.sync(), settled,
    'the per-frame unchanged path returns the cached result without allocating');
  assert.deepEqual(applied, [false]);
  assert.deepEqual(sync.diagnostics(), { appliedPowered: false, sequence: 1 });
});

test('render-only circuit sync observes repair and free-play power authoritatively', () => {
  const state = campaignState(false);
  const applied = [];
  const sync = createCeilingCircuitRenderSync({
    state,
    readPowered: ceilingCircuitPowered,
    applyPowered(powered) {
      applied.push(powered);
      return true;
    },
  });

  sync.sync();
  state.shop.reno.architecture.components.ceiling.restored = true;
  assert.deepEqual(sync.sync(), {
    powered: true,
    changed: true,
    rendererChanged: true,
    sequence: 2,
  });
  state.campaign.enabled = false;
  assert.equal(sync.sync().changed, false, 'free play remains powered after the repair state');
  assert.deepEqual(applied, [false, true]);
});

test('render-only circuit sync records an applied authority change even when shell already matches', () => {
  const state = { campaign: { enabled: false } };
  let calls = 0;
  const sync = createCeilingCircuitRenderSync({
    state,
    applyPowered(powered) {
      calls += 1;
      assert.equal(powered, true);
      return false;
    },
  });
  const first = sync.sync();
  assert.equal(first.changed, true);
  assert.equal(first.rendererChanged, false);
  assert.equal(sync.sync().changed, false);
  assert.equal(calls, 1);
});

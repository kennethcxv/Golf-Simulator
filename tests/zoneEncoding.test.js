import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE, ZONE_NAMES, ZONE_TEX_SCALE, ZONE_MAX_ID } from '../src/sim/constants.js';

// The terrain data texture packs zone ids as id × ZONE_TEX_SCALE into a Uint8;
// the splat shader decodes with floor(byte / SCALE + 0.5). A silent byte wrap
// renders the WRONG SURFACE (the cream-and-black-bands incident) — these tests
// make that class of bug loud.

test('every zone id survives the byte pack without wrapping', () => {
  for (const [name, id] of Object.entries(ZONE)) {
    const packed = id * ZONE_TEX_SCALE;
    assert.ok(packed <= 255, `${name} (${id}) packs to ${packed} — over 255, the Uint8 would wrap`);
  }
});

test('the pack → decode round trip is the identity for every zone', () => {
  const seen = new Set();
  for (const [name, id] of Object.entries(ZONE)) {
    const byte = Math.min(255, id * ZONE_TEX_SCALE);
    const decoded = Math.floor((byte * 255) / 255 / ZONE_TEX_SCALE + 0.5); // mirrors the GLSL
    assert.equal(decoded, id, `${name}: ${id} → byte ${byte} → decoded ${decoded}`);
    assert.ok(!seen.has(decoded), `${name} collides with another zone after decode`);
    seen.add(decoded);
  }
});

test('zone ids are dense, named, and leave packing headroom', () => {
  assert.equal(ZONE_MAX_ID, Object.keys(ZONE).length - 1, 'ids are 0..N-1 with no gaps');
  assert.equal(ZONE_NAMES.length, ZONE_MAX_ID + 1, 'every zone has a display name');
  // room for at least one future zone before the byte runs out
  assert.ok((ZONE_MAX_ID + 1) * ZONE_TEX_SCALE <= 255, 'no headroom left for a new zone — shrink ZONE_TEX_SCALE');
});

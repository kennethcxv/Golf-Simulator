// J2 — the reveal legend is one authority, derived, and honest about overlap.
//
// The marker mesh, HUD chips and reticle all read MEDIUM_STYLE; the per-medium
// tool lists are DERIVED from the routing (toolsForMedium), so the legend can
// never disagree with what the cleaning gate does. The declared overlaps are
// pinned as facts: the broom/dustpan/trashbag trio is a debris pipeline, and
// the vacuum genuinely lifts both media.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MEDIUM, MEDIUM_STYLE, toolMedia, toolsForMedium,
} from '../src/data/cleaningTools.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every medium has a style: distinct colour, plain label, a verb', () => {
  const media = Object.values(MEDIUM);
  const seen = new Set();
  for (const medium of media) {
    const style = MEDIUM_STYLE[medium];
    assert.ok(style, `${medium} has a style`);
    assert.ok(Number.isInteger(style.color), `${medium} colour is a number`);
    assert.ok(style.label && !/[—_]/.test(style.label), `${medium} label is plain words`);
    assert.ok(style.verb, `${medium} names what to do about it`);
    assert.ok(!seen.has(style.color), `${medium} colour is distinct`);
    seen.add(style.color);
  }
});

test('the legend colours are a warm/cool pair, not two of a kind', () => {
  // debris reads warm (dry, sweepable), grime reads cool (wet/suction work) -
  // hue distance is what survives most colour-vision types.
  const hueOf = (c) => {
    const r = (c >> 16) & 255; const g = (c >> 8) & 255; const b = c & 255;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    if (max === min) return 0;
    let h;
    if (max === r) h = ((g - b) / (max - min)) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    return ((h * 60) + 360) % 360;
  };
  const a = hueOf(MEDIUM_STYLE[MEDIUM.DEBRIS].color);
  const b = hueOf(MEDIUM_STYLE[MEDIUM.GRIME].color);
  const dist = Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  assert.ok(dist > 90, `hue distance ${dist.toFixed(0)}° keeps the pair apart`);
});

test('the per-medium tool lists are derived from the routing, and the overlaps are the declared ones', () => {
  const debrisTools = toolsForMedium(MEDIUM.DEBRIS);
  const grimeTools = toolsForMedium(MEDIUM.GRIME);
  // the debris pipeline, by design
  for (const id of ['broom', 'dustpan', 'trashbag', 'vacuum']) {
    assert.ok(debrisTools.includes(id), `${id} shifts loose debris`);
  }
  // the wet/suction bench
  for (const id of ['mop', 'vacuum', 'washer', 'cloth', 'sponge']) {
    assert.ok(grimeTools.includes(id), `${id} shifts ground-in grime`);
  }
  // the DECLARED overlap: the vacuum is the one tool on both lists
  const overlap = debrisTools.filter((id) => grimeTools.includes(id));
  assert.deepEqual(overlap, ['vacuum'],
    'the vacuum is the declared two-media tool; any other overlap is a routing drift');
  // the sprayer prepares, it does not remove
  assert.deepEqual(toolMedia('spray'), [], 'the sprayer removes nothing');
});

test('the marker mesh derives its colours from the legend (no hand-typed copies)', () => {
  const source = readFileSync(path.join(repo, 'src', 'render3d', 'clubhouse.js'), 'utf8');
  assert.match(source, /MEDIUM_STYLE\[MEDIUM\.DEBRIS\]\.color/,
    'clubhouse.js reads the debris colour from MEDIUM_STYLE');
  assert.match(source, /MEDIUM_STYLE\[MEDIUM\.GRIME\]\.color/,
    'clubhouse.js reads the grime colour from MEDIUM_STYLE');
});

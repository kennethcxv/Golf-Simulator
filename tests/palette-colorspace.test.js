// Pin the sRGB-hex -> linear conversion used by every Blender asset builder.
//
// Why this test exists.  `Designs/ProShop/Spike/TEXTURE_VALIDATION.md` Arm C
// authored the ART_BIBLE §8 medium walnut `#6B4A2F` by dividing the hex bytes by
// 255 and writing (0.420, 0.290, 0.184) straight into a glTF baseColorFactor.
// baseColorFactor is LINEAR.  The surface shipped as `#AD9377`, a washed-out tan
// nowhere near walnut, and nothing in the pipeline objected — not the exporter,
// not the GLB validator, not the renderer.
//
// Every hex in ART_BIBLE.md §8 lands wrong the same way if the conversion is
// derived by eye, so the conversion is pinned here rather than trusted.
//
// The expected values below are computed in this file from the IEC 61966-2-1
// EOTF, independently of the Python implementation.  The test compares two
// separate implementations of the standard against each other; it is not the
// Python code marking its own homework.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BLENDER_TOOLS = resolve(HERE, '..', 'tools', 'blender');

// ---------------------------------------------------------------------------
// Independent reference implementation (JS), straight from the standard.
// ---------------------------------------------------------------------------
function srgbChannelToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function hexToLinear(hex) {
  const h = hex.replace(/^#/, '');
  assert.strictEqual(h.length, 6, `expected six-digit hex, got ${hex}`);
  return [0, 2, 4].map((i) => srgbChannelToLinear(parseInt(h.slice(i, i + 2), 16) / 255));
}

function hexToNaiveBytes(hex) {
  const h = hex.replace(/^#/, '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

// ---------------------------------------------------------------------------
// Call the real production conversion. `palette.py` deliberately imports no bpy
// so it runs under plain CPython; if that ever stops being true this throws and
// the test fails loudly rather than silently skipping.
// ---------------------------------------------------------------------------
function pythonPalette(script) {
  const src = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(BLENDER_TOOLS)})`,
    'import palette',
    script,
  ].join('\n');
  let out;
  try {
    out = execFileSync('python', ['-c', src], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const detail = (err.stderr || err.message || '').toString().trim();
    throw new Error(`tools/blender/palette.py is not importable by plain CPython: ${detail}`);
  }
  return JSON.parse(out);
}

const EPS = 1e-9;

test('hex_to_linear_rgba matches the sRGB EOTF for every ART_BIBLE §8 colour', () => {
  const bible = pythonPalette('print(json.dumps(dict(palette.ART_BIBLE_SRGB_HEX)))');
  const converted = pythonPalette(
    'print(json.dumps({k: palette.hex_to_linear_rgba(v) for k, v in palette.ART_BIBLE_SRGB_HEX.items()}))',
  );

  assert.ok(Object.keys(bible).length >= 12, 'expected the full §8 table');

  for (const [name, hex] of Object.entries(bible)) {
    const expected = hexToLinear(hex);
    const actual = converted[name];
    assert.strictEqual(actual.length, 4, `${name}: expected RGBA`);
    assert.strictEqual(actual[3], 1.0, `${name}: default alpha should be 1`);
    for (let i = 0; i < 3; i += 1) {
      assert.ok(
        Math.abs(actual[i] - expected[i]) < EPS,
        `${name} (#${hex}) channel ${i}: got ${actual[i]}, expected ${expected[i]}`,
      );
    }
  }
});

test('medium walnut #6B4A2F produces the documented linear baseColorFactor', () => {
  // The exact value ART_BIBLE.md §8 now publishes. Hard-coded on purpose: if the
  // conversion drifts, this fails without needing anyone to recompute anything.
  const EXPECTED = [0.14702727, 0.06847817, 0.02842604];
  const actual = pythonPalette("print(json.dumps(palette.hex_to_linear_rgba('6B4A2F')))");
  for (let i = 0; i < 3; i += 1) {
    assert.ok(
      Math.abs(actual[i] - EXPECTED[i]) < 1e-6,
      `channel ${i}: got ${actual[i]}, expected ${EXPECTED[i]}`,
    );
  }
});

test('the Arm C bug shape is materially different from the correct value', () => {
  // Negative control. If someone "simplifies" hex_to_linear_rgba back into a
  // divide-by-255 the previous test would still pass against a matching JS
  // reference only if that reference broke too — this one cannot pass either way.
  const HEX = '6B4A2F';
  const correct = hexToLinear(HEX);
  const naive = hexToNaiveBytes(HEX);
  const actual = pythonPalette(`print(json.dumps(palette.hex_to_linear_rgba('${HEX}')))`);

  // The two answers must be far apart, otherwise this control proves nothing.
  const gap = Math.max(...[0, 1, 2].map((i) => Math.abs(correct[i] - naive[i])));
  assert.ok(gap > 0.2, `control is toothless: correct and naive differ by only ${gap}`);

  for (let i = 0; i < 3; i += 1) {
    assert.ok(
      Math.abs(actual[i] - naive[i]) > 1e-3,
      `channel ${i} equals the raw byte value ${naive[i]} — baseColorFactor is linear, not sRGB`,
    );
  }

  // And the wrong answer is available under its own name, so a builder that
  // genuinely wants sRGB floats does not reinvent it.
  const srgbFloats = pythonPalette(`print(json.dumps(palette.hex_to_srgb_floats('${HEX}')))`);
  for (let i = 0; i < 3; i += 1) {
    assert.ok(Math.abs(srgbFloats[i] - naive[i]) < EPS, `hex_to_srgb_floats channel ${i}`);
  }
});

test('the conversion round-trips back to the authored hex', () => {
  const round = pythonPalette([
    'out = {}',
    'for k, v in palette.ART_BIBLE_SRGB_HEX.items():',
    '    lin = palette.hex_to_linear_rgba(v)',
    '    out[k] = "".join("%02X" % round(palette.linear_channel_to_srgb(c) * 255) for c in lin[:3])',
    'print(json.dumps(out))',
  ].join('\n'));
  const bible = pythonPalette('print(json.dumps(dict(palette.ART_BIBLE_SRGB_HEX)))');
  for (const [name, hex] of Object.entries(bible)) {
    assert.strictEqual(round[name], hex.toUpperCase(), `${name} did not survive the round trip`);
  }
});

test('the Blender builder library re-exports the shared conversion, not a copy', () => {
  // The whole point of splitting palette.py out was to have ONE implementation.
  // A second private copy inside assets_51_100_lib.py would drift.
  const lib = readFileSync(join(BLENDER_TOOLS, 'assets_51_100_lib.py'), 'utf8');
  assert.ok(
    /^from palette import \(/m.test(lib),
    'assets_51_100_lib.py should import the conversion from palette.py',
  );
  assert.ok(
    !/def\s+hex_to_linear_rgba\s*\(/.test(lib),
    'assets_51_100_lib.py redefines hex_to_linear_rgba — there must be exactly one implementation',
  );
  assert.ok(
    !/\*\*\s*2\.2\b/.test(lib),
    'a gamma-2.2 power curve is not the sRGB EOTF',
  );
});

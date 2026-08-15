// Runtime GLBs for the pro-shop sheets must respect the ART_BIBLE §7.3 resolution
// ceiling.
//
// Why this test exists. The Blender builder exports the canonical and runtime GLBs
// identically — both 1024² — and the resolution ceiling is applied afterwards by
// `tools/blender/pack_ktx2.mjs`. That makes the reduction trivially easy to lose:
// re-run the builder, forget the pack step, and 12 MB per asset silently becomes
// 48 MB with nothing failing and no visible change. This is the check that fails.
//
// It reads image dimensions out of the GLB's own bytes rather than trusting a
// manifest, because a manifest is the thing that goes stale.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SHEETS = ['sheet_07', 'sheet_08'];

// ART_BIBLE §7.3: 512² is the hero ceiling for a tiling material in this room —
// it supplies 768 texels/yd at a 0.67 yd tile, which is what the display resolves
// at the closest standoff the collision system permits.
const MAX_DIMENSION = 512;

/** Image dimensions from the file's own header. PNG, JPEG and KTX2. */
function imageSize(buf) {
  // PNG: 8-byte signature, then IHDR length+type, then width/height.
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), kind: 'png' };
  }
  // KTX2: 12-byte identifier, vkFormat, typeSize, then pixelWidth/Height.
  if (buf.length > 32 && buf[0] === 0xab && buf[1] === 0x4b && buf[2] === 0x54 && buf[3] === 0x58) {
    return { width: buf.readUInt32LE(20), height: buf.readUInt32LE(24), kind: 'ktx2' };
  }
  // JPEG: walk the marker chain to a start-of-frame.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      // SOF0..SOF15, excluding the non-frame markers DHT (c4), JPG (c8), DAC (cc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), kind: 'jpeg' };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** Every embedded image in a GLB, with its dimensions. */
function glbImages(path) {
  const buf = readFileSync(path);
  assert.strictEqual(buf.readUInt32LE(0), 0x46546c67, `${path} is not a GLB`);
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  // The binary chunk follows the JSON chunk, both 4-byte aligned.
  const binStart = 20 + jsonLength + 8;
  const views = json.bufferViews || [];
  return (json.images || []).map((image, index) => {
    let size = null;
    if (image.bufferView != null) {
      const view = views[image.bufferView];
      const offset = binStart + (view.byteOffset || 0);
      size = imageSize(buf.subarray(offset, offset + Math.min(view.byteLength, 4096)));
    }
    return { index, name: image.name || `(image ${index})`, mimeType: image.mimeType, ...(size || {}) };
  });
}

function runtimeGlbs() {
  const out = [];
  for (const sheet of SHEETS) {
    const dir = join(REPO, 'vendor', 'models', 'assets_51_100', sheet);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.glb')) out.push({ sheet, file, path: join(dir, file) });
    }
  }
  return out;
}

test('sheet_07 and sheet_08 runtime GLBs exist to check', () => {
  const files = runtimeGlbs();
  assert.ok(files.length >= 20, `expected the sheet_07/08 runtime set, found ${files.length}`);
});

test('no runtime texture exceeds the §7.3 resolution ceiling', () => {
  const offenders = [];
  for (const { sheet, file, path } of runtimeGlbs()) {
    for (const image of glbImages(path)) {
      if (!image.width) continue; // an unparsed format is caught by the next test
      if (Math.max(image.width, image.height) > MAX_DIMENSION) {
        offenders.push(`${sheet}/${file}: ${image.name} is ${image.width}x${image.height}`);
      }
    }
  }
  assert.deepStrictEqual(
    offenders, [],
    'Textures above the ceiling. Re-run the pack step:\n'
    + '  node tools/blender/pack_ktx2.mjs --in <runtime.glb> --out <runtime.glb> --max-size 512\n'
    + offenders.join('\n'),
  );
});

test('every embedded runtime image is a format this budget can measure', () => {
  const unparsed = [];
  for (const { sheet, file, path } of runtimeGlbs()) {
    for (const image of glbImages(path)) {
      if (!image.width) unparsed.push(`${sheet}/${file}: ${image.name} (${image.mimeType})`);
    }
  }
  // An unmeasurable image would pass the ceiling test by default, which would make
  // that test a no-op rather than a check.
  assert.deepStrictEqual(unparsed, [], `unrecognised image formats:\n${unparsed.join('\n')}`);
});

test('asset_065 carries the textures §7.4 requires', () => {
  const path = join(
    REPO, 'vendor', 'models', 'assets_51_100', 'sheet_07',
    'asset_065_stockroom_worktable.glb',
  );
  const images = glbImages(path);
  assert.ok(images.length > 0, 'asset_065 must ship with embedded images - ART_BIBLE §7.4');
  // The estimated resident cost is the number the texture-memory policy projects
  // from, so pin it rather than let it drift silently.
  const residentMB = images.reduce(
    (acc, i) => acc + (i.width * i.height * (i.kind === 'ktx2' ? 1 : 4) * (4 / 3)) / 1048576,
    0,
  );
  assert.ok(
    residentMB <= 13,
    `asset_065 resident texture estimate ${residentMB.toFixed(1)} MB exceeds the 13 MB budget`,
  );
});

// NO PRINTED TAGS, IN ANY SHIPPED ASSET.
//
// The tag was asked for three times and reported gone twice. Both earlier
// passes deleted the tag they had been looking at and left others standing,
// because nobody ever swept the whole shipped set. A repo-wide scan found NINE
// GLBs still carrying printed codes after the runtime sticker was removed:
//
//   checkout/scannable_product_box            PRODUCT_BARCODE + M_BoxBarcode
//   clubhouse/checkout_product_shoe_box       12 x ShoeBoxBarcodeBar_*
//   clubhouse/checkout_product_folded_bottom  FoldedSizeTag
//   clubhouse/delivery_fixture_product_*      11 bars each, on FIVE cartons
//   clubhouse/provisions_fairway_spring_water WATER_BARCODE_BACKING + 13 bars
//
// The delivery cartons sit on the shop floor in every screenshot of the room.
//
// This test is the sweep, kept. It reads every .glb under vendor/models and
// fails if any of them carries a mesh or material whose name reads as printed
// signage. ANCHORS are deliberately not matched: BARCODE_AREA and
// ANCHOR_ProductBarcode are empties that draw nothing and only record which
// face of a package a reader would point at.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';

const TAG_NAME = /(barcode|swingtag|hangtag|pricetag|shelftag|sizetag|pricerail|pricecard|qrcode|qr_code)/i;

function everyGlb(dir) {
  const found = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.glb')) found.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found;
}

test('the tag matcher actually matches a tag', () => {
  // The negative control. A sweep that cannot recognise signage would report a
  // clean repo forever, which is exactly the failure mode this whole item is
  // about — the previous driver asserted the sticker EXISTED and shipped green.
  for (const name of [
    'PRODUCT_BARCODE', 'ShoeBoxBarcodeBar_04', 'FoldedSizeTag',
    'WATER_BARCODE_BACKING', 'M_BoxBarcode', 'ProductSwingTag_x', 'ShelfPriceRail',
  ]) {
    assert.ok(TAG_NAME.test(name), `${name} must be recognised as printed signage`);
  }
  // and must NOT match the invisible logical anchors, or the sweep would
  // demand the removal of empties that draw nothing
  for (const name of ['PICKUP_TARGET', 'SOCKET_GripPrimary', 'ProductBox_Body']) {
    assert.ok(!TAG_NAME.test(name), `${name} is not signage`);
  }
});

test('no shipped GLB carries a printed tag, barcode or QR code', async () => {
  const files = everyGlb(path.resolve('vendor/models'));
  assert.ok(files.length > 100, `expected the shipped asset set, found ${files.length} GLBs`);
  const io = new NodeIO();
  const offenders = [];
  for (const file of files) {
    let doc;
    try { doc = await io.read(file); } catch { continue; }
    const names = [];
    for (const node of doc.getRoot().listNodes()) {
      // MESH nodes only: an anchor is an empty and draws nothing
      if (node.getMesh() && TAG_NAME.test(node.getName() || '')) names.push(node.getName());
    }
    for (const material of doc.getRoot().listMaterials()) {
      if (TAG_NAME.test(material.getName() || '')) names.push(`material ${material.getName()}`);
    }
    if (names.length) offenders.push(`${path.relative(process.cwd(), file)}: ${names.join(', ')}`);
  }
  assert.deepEqual(offenders, [], `printed signage still ships:\n${offenders.join('\n')}`);
});

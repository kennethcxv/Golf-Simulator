// C7 (2026-08-04) — "Remove every price tag. Products, stocking, checkout…
// every tag, everywhere. On the shelf, in hand, at checkout, in the bag. Delete
// the code and the tests that assert tags exist. This reverses earlier work —
// remove it rather than flagging it off."
//
// Two things carried a price to the player, and both are deleted rather than
// gated:
//   - ProductSwingTag, a kraft plane hung off every club/hang/apparel product's
//     barcode anchor, which rode the goods onto the shelf, into the hands,
//     across the counter and into the bag;
//   - priceRail(), a "NAME  $12.34" board under every display bay.
//
// tests/catalog-product-visual.test.js now requires the ABSENCE of the swing
// tag on every SKU, which is the behavioural half. This file holds the half a
// behaviour test cannot: that the code is gone, and that no flag can bring it
// back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replaceAll('\r\n', '\n');

test('the product swing tag is deleted, not disabled', () => {
  const source = read('../src/render3d/clubhouse/catalogProductVisual.js');
  assert.doesNotMatch(source, /new THREE\.PlaneGeometry\(0\.078, 0\.046\)/,
    'the tag backing geometry is gone');
  assert.doesNotMatch(source, /includeCheckoutSwingTag/,
    'and so is the flag that used to switch it off — a flag is not a removal');
  // the barcode SURFACE stays: it decides which way a product turns to scan,
  // and every product still needs one
  assert.match(source, /barcodeSurface/, 'the scan-normal contract is untouched');
});

test('no fixture prints a price on a shelf', () => {
  // Comments naming the removed function are the RECORD of the removal, so
  // strip them before asking whether any code still reaches for it.
  const source = read('../src/render3d/clubhouse/fixtures.js')
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(source, /function priceRail/, 'the price rail is deleted');
  assert.doesNotMatch(source, /priceRail\(/, 'and nothing calls it');
  assert.doesNotMatch(source, /price[YZWH]\b/, 'and its layout parameters went with it');
  // …while the department boards, which name a section rather than price it,
  // are still there. Without this the test would pass on an empty file.
  assert.match(source, /function categorySign/, 'department signs remain');
});

test('no renderer builds sign copy containing a price', () => {
  // The sweep that would catch a price coming back somewhere new. A sign's copy
  // is an array of lines handed to a texture painter; match that shape rather
  // than the bare "$", so a currency-formatted UI string is not a finding.
  const dir = new URL('../src/render3d/', import.meta.url);
  const files = [];
  const walk = (u) => {
    for (const entry of fs.readdirSync(u, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, u);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.js')) files.push(child);
    }
  };
  walk(dir);
  const pricedSignCopy = /makeSignTexture\(\s*(?:\[[^\]]*|rows[^)]*)\$\{?(?:price|sku\.price|priceFor)/;
  const offenders = files
    .filter((f) => pricedSignCopy.test(fs.readFileSync(f, 'utf8')))
    .map((f) => f.pathname.split('/src/')[1]);
  assert.deepEqual(offenders, [], `these files paint a price onto a sign: ${offenders.join(', ')}`);
});

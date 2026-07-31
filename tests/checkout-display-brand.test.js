import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import {
  CHECKOUT_DISPLAY_BRAND_PRESENTATION,
  checkoutDisplayBrandLines,
  checkoutDisplayClubName,
  suppressLegacyCheckoutBrandNodes,
} from '../src/render3d/clubhouse/simplifiedRegisterMode.js';
import { frontDeskDisplayBrand } from '../src/ui/frontDesk.js';

const readFileAsync = promisify(readFile);
const registerSource = readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);

function makeLoader() {
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'checkout-brand-test-texture-stub',
    loadTexture: async () => new THREE.Texture(),
  }));
  return loader;
}

async function loadGlb(url) {
  const bytes = await readFileAsync(url);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => makeLoader().parse(data, '', resolve, reject));
}

const loadCheckoutAsset = (name) => loadGlb(
  new URL(`../assets/checkout/glb/${name}.glb`, import.meta.url),
);

function worldBounds(object) {
  object.updateWorldMatrix(true, true);
  object.geometry.computeBoundingBox();
  return object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
}

test('checkout display branding follows customized saves and has the Pine Hills default', () => {
  assert.equal(checkoutDisplayClubName({ clubName: 'Cedar Crest Golf' }), 'Cedar Crest Golf');
  assert.equal(checkoutDisplayClubName({ clubName: '  Custom Municipal  ' }), 'Custom Municipal');
  assert.equal(checkoutDisplayClubName({ clubName: '   ' }), 'Pine Hills Municipal Golf');
  assert.equal(checkoutDisplayClubName(null), 'Pine Hills Municipal Golf');
  assert.equal(
    checkoutDisplayClubName({ property: { id: 'willow-creek' } }),
    'Pine Hills Municipal Golf',
    'the internal property ID never becomes player-facing copy',
  );
  assert.deepEqual(checkoutDisplayBrandLines('Pine Hills Municipal Golf'), [
    'PINE HILLS', 'MUNICIPAL GOLF',
  ]);
  assert.deepEqual(checkoutDisplayBrandLines('Cedar Crest Golf'), ['CEDAR', 'CREST GOLF']);
  assert.ok(Object.isFrozen(CHECKOUT_DISPLAY_BRAND_PRESENTATION));
  assert.ok(Object.isFrozen(CHECKOUT_DISPLAY_BRAND_PRESENTATION.bagPanel));
});

test('the shared tee-desk receipt follows the same saved display brand', () => {
  assert.equal(frontDeskDisplayBrand({ clubName: 'Cedar Crest Golf' }), 'Cedar Crest Golf');
  assert.equal(frontDeskDisplayBrand({ clubName: '   ' }), 'Pine Hills Municipal Golf');
  assert.equal(frontDeskDisplayBrand({ property: { id: 'willow-creek' } }), 'Pine Hills Municipal Golf');
});

test('the Pine Hills bag panel sits ahead of the authored face WITHOUT deleting it', async () => {
  const bag = (await loadCheckoutAsset('shopping_bag')).scene;
  // Bag_Body_2 is NOT a decal. It is the loader's second primitive of Bag_Body —
  // the printed front panel's own GEOMETRY, one of the two quads that close the
  // front of the carrier. Suppressing it (which this test used to demand) punched
  // a hole through the bag and left the dark liner showing through; nobody saw it
  // while the bag stood upright behind a full-bleed brand panel, and everybody saw
  // it the moment the bag was laid flat with that face up (playtest round 5,
  // 2026-07-30 — "reads as a fallen box / open carton"). The authored club marks
  // on it are a TEXTURE, and the runtime's applyKraftBagStyle drops every map.
  const artwork = bag.getObjectByName('Bag_Body_2');
  const body = bag.getObjectByName('Bag_Body_1');
  assert.ok(artwork?.isMesh);
  assert.ok(body?.isMesh);
  const artworkBounds = worldBounds(artwork);
  const bodyBounds = worldBounds(body);
  const panel = CHECKOUT_DISPLAY_BRAND_PRESENTATION.bagPanel;

  assert.ok(panel.z > artworkBounds.max.z + 0.001,
    'dynamic branding clears the authored face instead of hiding behind it');
  assert.ok(panel.width < bodyBounds.max.x - bodyBounds.min.x);
  assert.ok(panel.height < bodyBounds.max.y - bodyBounds.min.y);
  assert.ok(panel.y - panel.height / 2 > bodyBounds.min.y);
  assert.ok(panel.y + panel.height / 2 < bodyBounds.max.y);
  // …and it is a STAMP on kraft paper, not a wrapper: bare paper must remain
  // around it on both axes, or the carrier reads as a printed carton.
  assert.ok(panel.width < (bodyBounds.max.x - bodyBounds.min.x) * 0.72,
    'the panel leaves bare paper across the face');
  assert.ok(panel.height < (bodyBounds.max.y - bodyBounds.min.y) * 0.55,
    'the panel leaves bare paper along the face');

  assert.deepEqual(suppressLegacyCheckoutBrandNodes(bag, 'shoppingBag'), []);
  assert.equal(artwork.visible, true, 'the printed face is paper the bag is made of');
  assert.equal(body.visible, true, 'suppressing artwork preserves the physical carrier');
  assert.ok(!CHECKOUT_DISPLAY_BRAND_PRESENTATION.legacyNodes.shoppingBag.includes('Bag_Body_2'),
    'no future round may hide the carrier front again');
});

test('the legacy shopping-bag fallback also loses only its old club marks', async () => {
  const bag = (await loadGlb(new URL(
    '../vendor/models/clubhouse/checkout_shopping_bag.glb',
    import.meta.url,
  ))).scene;
  const front = bag.getObjectByName('BagFront');
  const genericProShopLabel = bag.getObjectByName('ProShopWordmark');
  const suppressed = suppressLegacyCheckoutBrandNodes(bag, 'shoppingBag');

  assert.deepEqual(suppressed, ['PinehollowBadge', 'PinehollowWordmark']);
  assert.equal(front.visible, true);
  assert.equal(genericProShopLabel.visible, true);
  for (const name of suppressed) {
    assert.equal(bag.getObjectByName(name).visible, false);
  }
  assert.ok(
    CHECKOUT_DISPLAY_BRAND_PRESENTATION.bagPanel.z > worldBounds(front).max.z + 0.01,
    'the canonical panel also clears the fallback bag face',
  );
});

test('terminal suppression preserves its screen, keys, and card socket', async () => {
  const terminal = (await loadCheckoutAsset('payment_terminal')).scene;
  const legacyBrand = terminal.getObjectByName('t_brand');
  const screen = terminal.getObjectByName('Terminal_Screen');
  const socket = terminal.getObjectByName('CARD_INSERT_SOCKET');
  const key = terminal.getObjectByName('Terminal_Key_5');

  assert.deepEqual(
    suppressLegacyCheckoutBrandNodes(terminal, 'paymentTerminal'),
    ['t_brand'],
  );
  assert.equal(legacyBrand.visible, false);
  assert.equal(screen.visible, true);
  assert.equal(socket.visible, true);
  assert.equal(key.visible, true);
});

test('player-facing register paint paths contain no fixed legacy brand literal', () => {
  assert.doesNotMatch(
    registerSource,
    /(?:fillText|textTexture)\s*\(\s*['"`]\s*(?:FAIRHOLLOW|PINEHOLLOW)/i,
  );
  // The receipt paint path is gone with the receipt itself (round 7); the
  // remaining player-facing surfaces still take the saved club name live.
  assert.doesNotMatch(registerSource, /receiptContentTexture/);
  assert.match(registerSource, /const brand = displayClubName\(\)\.toUpperCase\(\)/);
});

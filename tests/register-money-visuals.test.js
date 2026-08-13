import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { PAYMENT_CARDS } from '../src/data/paymentCards.js';

import {
  CARD_HELD_PITCH, cashGpuPrewarmReleaseReady, cashGpuPrewarmShouldRelease,
  checkoutPaymentCardGpuPrewarmVariantIds, createCardMeshResourceLedger,
  createPaymentCardTextureCache,
  createKitMoneyMaterialCache,
  checkoutMoneyAssetStem, checkoutMoneyGpuPrewarmStems, checkoutPaymentGpuPrewarmStems,
  drawerPresentationVisible,
  shouldPrewarmDrawerCoin,
} from '../src/render3d/clubhouse/simplifiedRegisterMode.js';

test('Sheet-01 five-unit hero coin is tender-only visual routing', () => {
  assert.equal(checkoutMoneyAssetStem(0.05, 'tender'), 'cash_coin_05_sheet01');
  assert.equal(checkoutMoneyAssetStem(0.05, 'drawer'), 'cash_coin_05');
  assert.equal(checkoutMoneyAssetStem(0.05, 'change'), 'cash_coin_05');
});

test('money visual routing preserves every other denomination stem', () => {
  assert.equal(checkoutMoneyAssetStem(20, 'tender'), 'cash_bill_20');
  assert.equal(checkoutMoneyAssetStem(50, 'drawer'), 'cash_bill_50');
  assert.equal(checkoutMoneyAssetStem(0.01, 'change'), 'cash_coin_01');
  assert.equal(checkoutMoneyAssetStem(0.1, 'drawer'), 'cash_coin_10');
  assert.equal(checkoutMoneyAssetStem(0.5, 'tender'), 'cash_coin_50');
});

test('opaque-veil GPU warm-up covers every drawer asset and the tender-only hero coin', () => {
  assert.deepEqual(checkoutMoneyGpuPrewarmStems(), [
    'cash_bill_50', 'cash_bill_20', 'cash_bill_10', 'cash_bill_5', 'cash_bill_1',
    'cash_coin_50', 'cash_coin_25', 'cash_coin_10', 'cash_coin_05', 'cash_coin_01',
    'cash_coin_05_sheet01',
  ]);
});

test('opaque-veil payment warm-up also draws the exact first-use card kit', () => {
  assert.deepEqual(checkoutPaymentGpuPrewarmStems(), [
    ...checkoutMoneyGpuPrewarmStems(),
    'payment_card',
  ]);
});

test('opaque-veil card warm-up enumerates every finite customer card exactly once', () => {
  assert.deepEqual(
    checkoutPaymentCardGpuPrewarmVariantIds(),
    PAYMENT_CARDS.map((card) => card.id),
  );
  assert.equal(checkoutPaymentCardGpuPrewarmVariantIds().length, 6);
  assert.deepEqual(
    checkoutPaymentCardGpuPrewarmVariantIds([
      PAYMENT_CARDS[0], PAYMENT_CARDS[0], null, PAYMENT_CARDS[1],
    ]),
    [PAYMENT_CARDS[0].id, PAYMENT_CARDS[1].id],
  );
});

test('payment-card textures cache issuer designs globally and the member design by club', () => {
  const created = [];
  const cache = createPaymentCardTextureCache((clubName, design) => {
    const texture = {
      clubName,
      designId: design.id,
      disposeCalls: 0,
      dispose() { this.disposeCalls += 1; },
    };
    created.push(texture);
    return texture;
  });

  const primed = cache.prime('Willow Creek', PAYMENT_CARDS);
  assert.equal(primed.length, 6);
  assert.equal(created.length, 6);
  for (const { design, texture } of primed) {
    assert.equal(cache.get('Willow Creek', design), texture,
      'the live material reuses the exact texture uploaded by prewarm');
  }
  for (const { design, texture } of primed.filter(({ design }) => design.issuer)) {
    assert.equal(cache.get('A Different Club Name', design), texture,
      'issuer artwork ignores club names and keeps the exact prewarmed texture');
  }
  assert.equal(created.length, 6, 're-selecting customers does not repaint card canvases');
  assert.equal(cache.status().entries, 6);

  const disposed = cache.dispose();
  assert.equal(disposed.disposedTextures, 6);
  assert.equal(disposed.entries, 0);
  assert.equal(disposed.alreadyDisposed, false);
  assert.ok(created.every((texture) => texture.disposeCalls === 1));
  const repeated = cache.dispose();
  assert.equal(repeated.alreadyDisposed, true);
  assert.ok(created.every((texture) => texture.disposeCalls === 1),
    'idempotent scene teardown cannot double-dispose a cached map');
  assert.throws(() => cache.get('Willow Creek', PAYMENT_CARDS[0]), /disposed/);
});

test('club renames retain five issuer maps and replace only one bounded member map', () => {
  const created = [];
  const cache = createPaymentCardTextureCache((clubName, design) => {
    const texture = {
      clubName,
      designId: design.id,
      disposeCalls: 0,
      dispose() { this.disposeCalls += 1; },
    };
    created.push(texture);
    return texture;
  });
  const issuerCards = PAYMENT_CARDS.filter((card) => card.issuer);
  const memberCard = PAYMENT_CARDS.find((card) => !card.issuer);
  const first = cache.prime('Rename Club 0', PAYMENT_CARDS);
  const issuerTextures = new Map(first
    .filter(({ design }) => design.issuer)
    .map(({ design, texture }) => [design.id, texture]));
  let formerMember = first.find(({ design }) => design === memberCard).texture;

  for (let index = 1; index <= 100; index += 1) {
    const clubName = `Rename Club ${index}`;
    for (const design of issuerCards) {
      assert.equal(cache.get(clubName, design), issuerTextures.get(design.id),
        'issuer artwork contains no club pixels and remains the prewarmed texture');
    }
    const nextMember = cache.get(clubName, memberCard);
    assert.notEqual(nextMember, formerMember);
    assert.equal(formerMember.disposeCalls, 1,
      'the replaced member texture is released before the next one is retained');
    formerMember = nextMember;
    assert.equal(cache.status().entries, PAYMENT_CARDS.length);
    assert.equal(cache.status().liveTextures, PAYMENT_CARDS.length);
    assert.equal(cache.status().keys.filter((key) => key.startsWith('club:')).length, 1);
  }

  assert.equal(created.length, PAYMENT_CARDS.length + 100,
    'renames mint only the one club-dependent variant');
  assert.equal(cache.status().evictedTextures, 100);
  assert.equal(cache.status().texturesCreated - cache.status().disposedTextures,
    PAYMENT_CARDS.length, 'live texture accounting stays bounded with the map');
  const final = cache.dispose();
  assert.equal(final.disposed, true);
  assert.equal(final.disposedTextures, created.length);
  assert.ok(created.every((texture) => texture.disposeCalls === 1));
});

test('card-cache teardown isolates a throwing texture and retries without poisoning siblings', () => {
  const created = [];
  const cache = createPaymentCardTextureCache((clubName, design) => {
    const texture = {
      clubName,
      designId: design.id,
      disposeCalls: 0,
      dispose() {
        this.disposeCalls += 1;
        if (this.designId === PAYMENT_CARDS[2].id && this.disposeCalls === 1) {
          throw new Error('synthetic card texture failure');
        }
      },
    };
    created.push(texture);
    return texture;
  });
  cache.prime('Retry Club', PAYMENT_CARDS);

  const first = cache.dispose();
  assert.equal(first.disposed, false);
  assert.equal(first.entries, 1, 'only the failed texture remains under cache ownership');
  assert.equal(first.errors.length, 1);
  assert.equal(first.disposedTextures, PAYMENT_CARDS.length - 1,
    'a broken sibling cannot abort the rest of the cache');
  assert.throws(() => cache.get('Retry Club', PAYMENT_CARDS[0]), /disposing/,
    'a partially torn-down cache cannot mint unowned replacements');
  for (const texture of created.filter((entry) => entry.designId !== PAYMENT_CARDS[2].id)) {
    assert.equal(texture.disposeCalls, 1);
  }

  const retry = cache.dispose();
  assert.equal(retry.disposed, true);
  assert.equal(retry.entries, 0);
  assert.equal(retry.disposedTextures, PAYMENT_CARDS.length);
  assert.equal(created.find((entry) => entry.designId === PAYMENT_CARDS[2].id).disposeCalls, 2);
  assert.equal(cache.dispose().alreadyDisposed, true);
  for (const texture of created.filter((entry) => entry.designId !== PAYMENT_CARDS[2].id)) {
    assert.equal(texture.disposeCalls, 1, 'successful siblings are exact-once across retry');
  }
});

test('member-card rename factory failure preserves the prior live cache entry', () => {
  const memberCard = PAYMENT_CARDS.find((card) => !card.issuer);
  const created = [];
  let failFactory = false;
  const cache = createPaymentCardTextureCache((clubName, design) => {
    if (failFactory) throw new Error('synthetic member-card paint failure');
    const texture = {
      clubName,
      designId: design.id,
      disposeCalls: 0,
      dispose() { this.disposeCalls += 1; },
    };
    created.push(texture);
    return texture;
  });
  const original = cache.get('Stable Club', memberCard);
  failFactory = true;
  assert.throws(
    () => cache.get('Broken Rename', memberCard),
    /synthetic member-card paint failure/,
  );
  assert.equal(original.disposeCalls, 0,
    'a replacement is created before the prior live texture can be released');
  assert.equal(cache.status().entries, 1);
  failFactory = false;
  assert.equal(cache.get('Stable Club', memberCard), original,
    'failed rename leaves the prior key and texture authoritative');
  cache.dispose();
  assert.equal(original.disposeCalls, 1);
});

test('card-cache teardown disposes a factory-shared texture identity only once', () => {
  const shared = {
    disposeCalls: 0,
    dispose() { this.disposeCalls += 1; },
  };
  const cache = createPaymentCardTextureCache(() => shared);
  cache.prime('Shared Texture Club', PAYMENT_CARDS);
  assert.equal(cache.status().entries, PAYMENT_CARDS.length);
  assert.equal(cache.status().liveTextures, 1);
  assert.equal(cache.status().texturesCreated, 1);
  const disposed = cache.dispose();
  assert.equal(disposed.disposed, true);
  assert.equal(disposed.disposedTextures, 1);
  assert.equal(shared.disposeCalls, 1);
});

test('failed member replacement cannot dispose a texture still owned by an issuer alias', () => {
  const issuerCard = PAYMENT_CARDS.find((card) => card.issuer);
  const memberCard = PAYMENT_CARDS.find((card) => !card.issuer);
  const issuerTexture = {
    disposeCalls: 0,
    dispose() { this.disposeCalls += 1; },
  };
  const originalMemberTexture = {
    disposeCalls: 0,
    dispose() {
      this.disposeCalls += 1;
      throw new Error('synthetic original-member disposal failure');
    },
  };
  const cache = createPaymentCardTextureCache((clubName, design) => {
    if (design === issuerCard || clubName === 'Renamed Club') return issuerTexture;
    return originalMemberTexture;
  });

  assert.equal(cache.get('Original Club', issuerCard), issuerTexture);
  assert.equal(cache.get('Original Club', memberCard), originalMemberTexture);
  assert.throws(() => cache.get('Renamed Club', memberCard), /could not be replaced/);
  assert.equal(issuerTexture.disposeCalls, 0,
    'cleanup of the unused member alias cannot evict the live issuer map');
  assert.equal(cache.get('Any Club', issuerCard), issuerTexture);
  assert.equal(cache.status().entries, 3,
    'the pending member alias remains bounded metadata beside its issuer owner');
  assert.equal(cache.status().liveTextures, 2,
    'the pending member alias does not mint another Texture identity');
});

test('member-card rename rejects an empty factory result before evicting the healthy texture', () => {
  const memberCard = PAYMENT_CARDS.find((card) => !card.issuer);
  let empty = false;
  const original = {
    disposeCalls: 0,
    dispose() { this.disposeCalls += 1; },
  };
  const cache = createPaymentCardTextureCache(() => (empty ? null : original));
  assert.equal(cache.get('Healthy Club', memberCard), original);
  empty = true;
  assert.throws(
    () => cache.get('Empty Rename', memberCard),
    /no disposable texture/,
  );
  assert.equal(original.disposeCalls, 0);
  assert.equal(cache.status().entries, 1);
  cache.dispose();
  assert.equal(original.disposeCalls, 1);
});

test('failed old and replacement member disposers retain one bounded pending replacement', () => {
  const memberCard = PAYMENT_CARDS.find((card) => !card.issuer);
  const created = [];
  const cache = createPaymentCardTextureCache((clubName) => {
    const texture = {
      clubName,
      disposeCalls: 0,
      dispose() {
        this.disposeCalls += 1;
        throw new Error(`synthetic permanent ${clubName} disposal failure`);
      },
    };
    created.push(texture);
    return texture;
  });
  cache.get('Original Club', memberCard);
  assert.throws(() => cache.get('Renamed Club', memberCard), /could not be replaced/);
  assert.equal(cache.status().entries, 2,
    'the healthy prior owner and one failed replacement remain reachable');
  assert.equal(cache.status().liveTextures, 2);
  assert.throws(() => cache.get('Renamed Club', memberCard), /pending replacement is still live/);
  assert.equal(created.length, 2,
    'repeat sync retries the retained replacement instead of minting one per frame');
  assert.equal(cache.status().entries, 2);
});

test('distinct failed club renames reuse one pending canvas without allocation churn', () => {
  const memberCard = PAYMENT_CARDS.find((card) => !card.issuer);
  const created = [];
  const cache = createPaymentCardTextureCache((clubName) => {
    const texture = {
      clubName,
      disposeCalls: 0,
      dispose() {
        this.disposeCalls += 1;
        if (this.clubName === 'Original Club') {
          throw new Error('synthetic permanent original disposal failure');
        }
      },
    };
    created.push(texture);
    return texture;
  });
  const original = cache.get('Original Club', memberCard);

  for (let index = 0; index < 50; index += 1) {
    assert.throws(
      () => cache.get(`Blocked Rename ${index}`, memberCard),
      index === 0 ? /could not be replaced/ : /pending replacement is still live/,
    );
  }

  assert.equal(created.length, 2,
    'the first usable replacement remains pending instead of repainting every requested name');
  assert.equal(cache.status().entries, 2);
  assert.equal(cache.status().liveTextures, 2);
  assert.equal(cache.status().keys.filter((key) => key.startsWith('pending-replacement:')).length, 1);
  assert.equal(created[1].disposeCalls, 0,
    'the usable pending canvas stays owned until the old identity can release');
  assert.equal(original.disposeCalls, 50,
    'each request retries the exact failed owner without allocating another texture');
});

test('live-card resource ledger exhausts siblings and retries failed identities without its root', () => {
  const ledger = createCardMeshResourceLedger();
  const calls = new Map();
  const disposable = (name, { failOnce = false, texture = false } = {}) => ({
    name,
    ...(texture ? { isTexture: true } : {}),
    dispose() {
      const next = (calls.get(name) || 0) + 1;
      calls.set(name, next);
      if (failOnce && next === 1) throw new Error(`synthetic ${name} failure`);
    },
  });
  const brokenGeometry = disposable('broken-geometry', { failOnce: true });
  const goodGeometry = disposable('good-geometry');
  const ownedTexture = disposable('owned-texture', { texture: true });
  const firstMaterial = { ...disposable('first-material'), map: ownedTexture };
  const secondMaterial = disposable('second-material');
  const first = { userData: {}, geometry: brokenGeometry, material: firstMaterial };
  const second = { userData: {}, geometry: goodGeometry, material: secondMaterial };
  ledger.mark(first, { material: true });
  ledger.mark(second, { material: true });
  const root = {
    detachCalls: 0,
    traverse(visitor) { visitor(first); visitor(second); },
    removeFromParent() { this.detachCalls += 1; },
  };

  assert.throws(() => ledger.dispose(root), AggregateError);
  assert.equal(root.detachCalls, 1);
  assert.equal(calls.get('owned-texture'), 1);
  assert.equal(calls.get('first-material'), 1);
  assert.equal(calls.get('second-material'), 1);
  assert.equal(calls.get('good-geometry'), 1,
    'the throwing first geometry cannot skip its later sibling');
  assert.equal(ledger.status().retainedResources, 1);
  assert.equal(ledger.status().liveGeometries, 1);

  const retried = ledger.retry();
  assert.equal(retried.disposed, true);
  assert.equal(retried.retainedResources, 0);
  assert.equal(calls.get('broken-geometry'), 2);
  assert.equal(calls.get('good-geometry'), 1,
    'rootless retry touches only the exact failed identity');
  assert.equal(calls.get('first-material'), 1);
  assert.equal(calls.get('second-material'), 1);
  assert.equal(calls.get('owned-texture'), 1);
});

test('kit-money material ownership detaches clones and never disposes borrowed maps', () => {
  const cache = createKitMoneyMaterialCache();
  const borrowedMap = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: borrowedMap });
  let materialDisposals = 0;
  let mapDisposals = 0;
  material.addEventListener('dispose', () => { materialDisposals += 1; });
  borrowedMap.addEventListener('dispose', () => { mapDisposals += 1; });
  assert.equal(cache.getOrCreate('5|source', () => material), material);
  assert.equal(cache.getOrCreate('5|alias', () => material), material);

  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  root.add(mesh);
  const first = cache.dispose({ detachFrom: root });
  assert.equal(first.materialsCreated, 1);
  assert.equal(first.disposedMaterials, 1);
  assert.equal(first.liveMaterials, 0);
  assert.equal(first.entries, 0);
  assert.equal(first.disposed, true);
  assert.equal(mesh.material, null,
    'the later clubhouse scene walk cannot rediscover the owned clone');
  assert.equal(materialDisposals, 1);
  assert.equal(mapDisposals, 0, 'material ownership never expands to its borrowed texture');
  assert.equal(cache.dispose({ detachFrom: root }).alreadyDisposed, true);
  assert.equal(materialDisposals, 1);
  assert.equal(mapDisposals, 0);

  mesh.geometry.dispose();
  borrowedMap.dispose();
});

test('kit-money material teardown exhausts siblings and retries only the failed clone', () => {
  const cache = createKitMoneyMaterialCache();
  const broken = {
    name: 'broken-money-material',
    disposeCalls: 0,
    dispose() {
      this.disposeCalls += 1;
      if (this.disposeCalls === 1) throw new Error('synthetic money material failure');
    },
  };
  const good = {
    name: 'good-money-material',
    disposeCalls: 0,
    dispose() { this.disposeCalls += 1; },
  };
  cache.getOrCreate('broken', () => broken);
  cache.getOrCreate('good', () => good);

  const first = cache.dispose();
  assert.equal(first.disposed, false);
  assert.equal(first.liveMaterials, 1);
  assert.equal(first.releasedMaterials, 1);
  assert.equal(first.errors.length, 1);
  assert.equal(good.disposeCalls, 1);
  assert.equal(broken.disposeCalls, 1);

  const retry = cache.dispose();
  assert.equal(retry.disposed, true);
  assert.equal(retry.liveMaterials, 0);
  assert.equal(good.disposeCalls, 1);
  assert.equal(broken.disposeCalls, 2);
});

test('cash GPU representatives release only after every expected model was drawn', () => {
  const expected = checkoutPaymentGpuPrewarmStems().length;
  const cardVariantIds = checkoutPaymentCardGpuPrewarmVariantIds();
  const complete = {
    ready: true, built: expected, expected, drawn: expected,
    expectedDrawUnits: 19, observedDrawUnits: 19,
    expectedCardVariants: cardVariantIds.length,
    observedCardVariants: cardVariantIds.length,
    expectedCardVariantIds: cardVariantIds,
    observedCardVariantIds: [...cardVariantIds],
  };
  assert.equal(cashGpuPrewarmReleaseReady(complete), true);
  assert.equal(cashGpuPrewarmReleaseReady({ ...complete, ready: false }), false);
  assert.equal(cashGpuPrewarmReleaseReady({ ...complete, built: expected - 1 }), false);
  assert.equal(cashGpuPrewarmReleaseReady({ ...complete, drawn: expected - 1 }), false);
  assert.equal(cashGpuPrewarmReleaseReady({ ...complete, observedDrawUnits: 18 }), false);
  const missingCardEvidence = { ...complete };
  delete missingCardEvidence.expectedCardVariantIds;
  delete missingCardEvidence.observedCardVariantIds;
  assert.equal(cashGpuPrewarmReleaseReady(missingCardEvidence), false,
    'legacy 12/12 stem evidence cannot bypass exact card-variant observation');
  assert.equal(cashGpuPrewarmReleaseReady({
    ...complete,
    observedCardVariants: cardVariantIds.length - 1,
    observedCardVariantIds: cardVariantIds.slice(0, -1),
  }), false);
  assert.equal(cashGpuPrewarmReleaseReady({
    ...complete,
    observedCardVariantIds: [...cardVariantIds.slice(0, -1), 'not-a-live-card'],
  }), false, 'six draws of the wrong variants cannot satisfy the exact set gate');
});

test('a readiness timeout requires explicit abort and cannot impersonate a draw', () => {
  const incomplete = {
    ready: false, built: 0, expected: checkoutPaymentGpuPrewarmStems().length, drawn: 0,
    expectedDrawUnits: 0, observedDrawUnits: 0,
    expectedCardVariants: 6, observedCardVariants: 0,
    expectedCardVariantIds: checkoutPaymentCardGpuPrewarmVariantIds(),
    observedCardVariantIds: [],
  };
  assert.equal(cashGpuPrewarmShouldRelease(incomplete), false);
  assert.equal(cashGpuPrewarmShouldRelease(incomplete, { abort: true }), true);
});

test('payment prewarm observes real render callbacks and preserves prior hooks', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /const prior = object\.onAfterRender/);
  assert.match(source, /prior\?\.apply\(this, args\)/);
  assert.match(source, /cashGpuPrewarmObservedDrawUnits\.add\(drawUnit\)/);
  assert.match(source, /cashGpuPrewarmObservedCardVariantIds\.add\(cardVariantId\)/);
  assert.match(source, /object\.onAfterRender !== observer\.wrapper/);
  assert.match(source, /else delete observer\.object\.onAfterRender/,
    'an inherited hook is restored by deleting only the installed own wrapper');
  assert.doesNotMatch(source, /cashGpuPrewarmDrawn = cashGpuPrewarmRoot\.children\.length/,
    'model existence is not evidence that the renderer submitted it');
  assert.match(source, /const model = moneySpec[\s\S]*makeMoney\(moneySpec\.denom, moneySpec\.from\)/,
    'cash prewarm must build the same tinted denomination variant used by live payment');
  assert.doesNotMatch(source, /for \(const stem of checkoutPaymentGpuPrewarmStems\(\)\) \{\s*const model = merch\.instantiateKit\(stem/,
    'raw GLB money materials are not the live tinted cash shaders');
  assert.match(source, /cashGpuPrewarmExactVariantStems\.add\(stem\)/);
  assert.match(source, /cardTextureCache\.prime\(displayClubName\(\), PAYMENT_CARDS\)/,
    'all six live card textures are created before the opaque draw');
  assert.match(source, /gpuPrewarmOwnedMaterial/,
    'temporary card-variant materials have an explicit release owner');
  assert.match(source, /set\.delete\(resource\)/,
    'successful wrapper releases leave only failed identities under retry ownership');
  assert.match(source, /cashGpuPrewarmReleased = cashGpuPrewarmOwnedMaterials\.size === 0/,
    'prewarm cannot report released while an owned wrapper remains live');
});

test('warm traversal forces exact payment meshes despite program-key deduplication', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/courseScene.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /forceExactPaymentRepresentative = typeof o\.userData\?\.gpuPrewarmDrawUnit/);
  assert.match(source, /let needed = forceExactPaymentRepresentative/);
  assert.match(source, /PAYMENT_GPU_PREWARM_NOT_READY/);
  assert.match(source, /PAYMENT_GPU_PREWARM_NOT_OBSERVED/);
  assert.doesNotMatch(source, /releaseCashGpuPrewarmRepresentatives\?\.\(\{ drawn: true \}\)/);
});

test('closed drawer presentation stays culled while every coin atlas prewarms', () => {
  assert.equal(drawerPresentationVisible(0, 0), false);
  assert.equal(drawerPresentationVisible(1, 0), true);
  assert.equal(drawerPresentationVisible(0, 0.5), true);
  for (const denomination of [0.01, 0.05, 0.1, 0.25, 0.5]) {
    assert.equal(shouldPrewarmDrawerCoin(denomination), true);
  }
  for (const denomination of [0, 1, 5, 10, 20, 50, null, undefined]) {
    assert.equal(shouldPrewarmDrawerCoin(denomination), false);
  }
});

test('the customer-held payment card presents its face toward the cashier', () => {
  const normal = new THREE.Vector3(0, 1, 0)
    .applyEuler(new THREE.Euler(CARD_HELD_PITCH, 0, 0));
  assert.ok(normal.z > 0.5, `held card face normal should point toward staff (+Z), got ${normal.z}`);
});

test('payment-card branding follows customer identity without repainting the bag', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /let bagBrandSignature = ''/);
  assert.match(source, /let cardBrandSignature = ''/);
  assert.match(source, /const nextCardSignature = `\$\{clubSignature\}\\u0000\$\{paymentCard\.id\}`/);
  assert.match(source, /if \(clubSignature !== bagBrandSignature\)/);
  assert.match(source, /if \(nextCardSignature !== cardBrandSignature\)/);
  assert.match(source, /cardBrandMaterial\.map = cardTextureCache\.get\(clubSignature, paymentCard\)/);
  const syncStart = source.indexOf('function syncPhysicalBrand()');
  const syncEnd = source.indexOf('\n  syncPhysicalBrand();', syncStart);
  const sync = source.slice(syncStart, syncEnd);
  assert.doesNotMatch(sync, /cardBrandMaterial\.map\?\.dispose\(\)/,
    'customer changes swap cached maps without invalidating their GPU residency');
});

test('every live card disposes only its owned geometry and fallback resources', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /const cardOwnedResources = createCardMeshResourceLedger\(\)/);
  assert.match(source, /function disposeCardMesh\(onError = null\)/);
  assert.match(source, /checkoutCardOwnedGeometry/);
  assert.match(source, /checkoutCardOwnedMaterial/);
  assert.match(source, /cardOwnedResources\.dispose\(disposingCard, \{ onError: capture \}\)/);
  assert.match(source, /cardOwnedResources\.retry\(\{ onError: capture \}\)/);
  assert.match(source, /cardResourceStatus\.disposed === true/,
    'register teardown cannot report complete while a failed card identity is retained');
  assert.match(source, /cardOwnedResourceStatus/);
});

test('scene teardown releases cached canvases without taking ownership of GLB resources', () => {
  const registerSource = fs.readFileSync(
    new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
    'utf8',
  );
  const clubhouseSource = fs.readFileSync(
    new URL('../src/render3d/clubhouse.js', import.meta.url),
    'utf8',
  );
  const releaseStart = registerSource.indexOf('function releaseCashGpuPrewarmRepresentatives');
  const releaseEnd = registerSource.indexOf('\n  let registerDisposalSummary', releaseStart);
  const release = registerSource.slice(releaseStart, releaseEnd);
  assert.match(release, /gpuPrewarmOwnedGeometry/);
  assert.match(release, /gpuPrewarmOwnedMaterial/);
  assert.doesNotMatch(release, /material\.map\?\.dispose|texture\.dispose/,
    'prewarm release disposes its wrappers but retains cache-owned maps and shared kit data');
  assert.match(registerSource, /let cardTextures = cardTextureCache\.dispose\(\)/);
  assert.match(registerSource, /let moneyMaterials = kitMoneyMaterials\.dispose\(\{ detachFrom: root \}\)/,
    'register teardown releases every detached or live denomination clone');
  assert.match(registerSource, /cardBrandMaterial\.map = null/,
    'the outer scene walk cannot rediscover the cache-owned live map');
  assert.match(clubhouseSource, /const registerDisposal = register\.dispose\?\.\(\) \|\| null/);
  assert.match(clubhouseSource, /register: registerDisposal/);
});

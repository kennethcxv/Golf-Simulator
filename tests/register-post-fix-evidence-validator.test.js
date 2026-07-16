import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EXPECTED_STAGE_LABELS,
  VALIDATION_FILE,
  validatePostFixEvidence,
} from '../tools/qa/validate-register-post-fix-evidence.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBM = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from('synthetic V_VP9 evidence'),
]);
const PRODUCTS = ['sku-a', 'sku-b', 'sku-c'];

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeMode(postFixRoot, mode) {
  const modeRoot = path.join(postFixRoot, mode);
  fs.mkdirSync(path.join(modeRoot, 'video'), { recursive: true });
  const log = [];
  EXPECTED_STAGE_LABELS[mode].forEach((label, index) => {
    const file = `${String(index + 1).padStart(2, '0')}-${label}.png`;
    fs.writeFileSync(path.join(modeRoot, file), PNG);
    log.push({ evidence: file, step: label });
  });
  for (let index = 1; index <= 3; index++) {
    log.push({
      action: `product ${index} rotated, scanned, and staged`,
      uid: `u${index}`,
      barcodeFacing: -1,
    });
  }
  for (let index = 1; index <= 3; index++) {
    log.push({
      action: 'physical product dragged into bag',
      aimedUid: `u${index}`,
      baggedUid: `u${index}`,
    });
  }
  fs.writeFileSync(path.join(modeRoot, 'video', `page@${mode}.webm`), WEBM);

  const shelfBefore = Object.fromEntries(PRODUCTS.map((skuId) => [skuId, 12]));
  const shelfAfter = Object.fromEntries(PRODUCTS.map((skuId) => [skuId, 11]));
  const customer = mode === 'card' ? 'Casey L.' : 'Robin K.';
  const manifest = {
    ok: true,
    mode,
    products: PRODUCTS,
    customer,
    videoRequested: true,
    audioVideoCapture: { requested: false },
    evidenceDirectory: modeRoot,
    beforeBooks: {
      units: 10,
      revenue: 100,
      held: 0,
      history: 4,
      shelf: shelfBefore,
    },
    final: {
      active: false,
      flow: null,
      tx: null,
      customer: {
        name: customer,
        phase: 'complete',
        placed: 3,
        cart: [],
        bought: true,
        paid: true,
      },
      queue: [],
      books: {
        units: 13,
        revenue: 130,
        held: 0,
        history: 5,
        lastTicket: {
          number: 5,
          customer,
          method: mode,
          total: 30,
          items: 3,
        },
        shelf: shelfAfter,
      },
    },
    log,
    console: {
      errors: [],
      pageErrors: [],
      failedRequests: [{ url: 'fixture.glb', error: 'net::ERR_ABORTED' }],
      nonAbortedFailedRequests: [],
      warnings: [],
    },
  };
  writeJson(path.join(modeRoot, 'latest-result.json'), manifest);
  return { modeRoot, manifest };
}

function makePass(t, pass = 1) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'register-post-fix-validator-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const passRoot = path.join(tempRoot, `pass-${pass}`);
  const postFixRoot = path.join(passRoot, 'post-fix');
  const modes = {
    card: makeMode(postFixRoot, 'card'),
    cash: makeMode(postFixRoot, 'cash'),
  };
  return { passRoot, postFixRoot, modes };
}

test('valid card and cash post-fix fixtures write a passing validation artifact', (t) => {
  const fixture = makePass(t, 3);
  const result = validatePostFixEvidence(fixture.passRoot, {
    generatedAt: '2026-07-15T00:00:00.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.pass, 3);
  assert.equal(result.modes.length, 2);
  assert.equal(result.failedChecks.length, 0);
  assert.equal(result.modes[0].playwrightVideo.tracks.vp9, true);
  assert.equal(fs.existsSync(path.join(fixture.postFixRoot, VALIDATION_FILE)), true);
  const artifact = JSON.parse(fs.readFileSync(result.output, 'utf8'));
  assert.equal(artifact.ok, true);
  assert.equal(artifact.policy.namedAudioCaptureAllowed, false);
});

test('missing stages, blocker images, duplicate videos, and named audio capture fail closed', (t) => {
  const fixture = makePass(t, 1);
  const card = fixture.modes.card;
  const receipt = fs.readdirSync(card.modeRoot).find((file) => /-receipt-printed\.png$/.test(file));
  fs.rmSync(path.join(card.modeRoot, receipt));
  fs.writeFileSync(path.join(card.modeRoot, '99-blocker-synthetic.png'), PNG);
  fs.writeFileSync(path.join(card.modeRoot, 'video', 'page@duplicate.webm'), WEBM);
  fs.writeFileSync(path.join(card.modeRoot, 'video', 'card-with-audio.webm'), WEBM);
  card.manifest.audioVideoCapture = { requested: true, output: 'card-with-audio.webm' };
  writeJson(path.join(card.modeRoot, 'latest-result.json'), card.manifest);

  const result = validatePostFixEvidence(fixture.passRoot);
  const ids = new Set(result.failedChecks.map((failure) => failure.id));
  assert.equal(result.ok, false);
  assert.equal(ids.has('card.screenshots.noBlockers'), true);
  assert.equal(ids.has('card.screenshots.stage.receipt-printed'), true);
  assert.equal(ids.has('card.video.noNamedAudioCapture'), true);
  assert.equal(ids.has('card.video.exactlyOnePageVideo'), true);
  assert.equal(ids.has('card.video.noOtherWebm'), true);
  assert.equal(JSON.parse(fs.readFileSync(result.output, 'utf8')).ok, false);
});

test('product, exact-once, queue, and diagnostic corruption cannot pass', (t) => {
  const fixture = makePass(t, 4);
  const cash = fixture.modes.cash;
  cash.manifest.products = ['sku-a', 'sku-a', 'sku-c'];
  cash.manifest.final.books.units = 14;
  cash.manifest.final.queue = [{ name: cash.manifest.customer }];
  cash.manifest.console.errors = ['synthetic console failure'];
  cash.manifest.console.failedRequests.push({ url: 'bad.glb', error: 'net::ERR_FAILED' });
  cash.manifest.console.nonAbortedFailedRequests.push({ url: 'bad.glb', error: 'net::ERR_FAILED' });
  writeJson(path.join(cash.modeRoot, 'latest-result.json'), cash.manifest);

  const result = validatePostFixEvidence(fixture.passRoot);
  const ids = new Set(result.failedChecks.map((failure) => failure.id));
  assert.equal(result.ok, false);
  for (const id of [
    'cash.products.distinct',
    'cash.books.unitsExactOnce',
    'cash.customer.removed',
    'cash.diagnostics.consoleErrors',
    'cash.diagnostics.nonAbortedManifest',
    'cash.diagnostics.nonAbortedDerived',
  ]) assert.equal(ids.has(id), true, id);
});

test('validator refuses roots outside the four named visual passes', () => {
  assert.throws(() => validatePostFixEvidence('qa/cash-register-production/final'), /pass-1.*pass-4/);
  assert.throws(() => validatePostFixEvidence(), /pass root is required/i);
});

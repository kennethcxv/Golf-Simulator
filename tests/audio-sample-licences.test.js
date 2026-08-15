// G3 (Goal 23) — A SAMPLE CANNOT SHIP WITHOUT ITS LICENCE.
//
// "Bring in real CC0 or CC-BY samples ... and REPORT EVERY LICENCE."
//
// Reporting every licence is not a thing you remember to do; it is a thing the
// build refuses to proceed without. This is the gate. It is written before a
// single sample exists precisely so that the first one added cannot slip
// through unrecorded — a credits file written after the fact is a credits file
// with holes in it, and on a Steam release that is a legal problem rather than
// a tidiness problem.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createSampleBank } from '../src/core/sampleBank.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const manifestPath = path.join(ROOT, 'Assets', 'audio', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Share-alike and non-commercial terms cannot ship in a paid game, so they are
// not merely absent from the allow-list, they are named as refused.
const REFUSED = /(-NC|-ND|-SA|nonCommercial|noDerivs|shareAlike)/i;

test('the allow-list is CC0 and CC-BY only, and says so', () => {
  assert.ok(Array.isArray(manifest.allowedLicences) && manifest.allowedLicences.length,
    'the manifest names the licences it will accept');
  for (const licence of manifest.allowedLicences) {
    assert.doesNotMatch(licence, REFUSED,
      `${licence} carries a non-commercial or share-alike term and cannot ship in a paid game`);
    assert.match(licence, /^CC0|^CC-BY/, `${licence} is not a CC0 or CC-BY licence`);
  }
});

test('EVERY sample names a licence on the allow-list, a source, and its file exists', () => {
  const samples = manifest.samples || [];
  for (const s of samples) {
    assert.ok(s.cue, 'every sample names the cue it serves');
    assert.ok(s.file, `${s.cue}: every sample names its file`);
    assert.ok(s.licence, `${s.cue}: every sample names its licence`);
    assert.ok(manifest.allowedLicences.includes(s.licence),
      `${s.cue}: ${s.licence} is not on the allow-list`);
    assert.ok(s.source && /^https?:\/\//.test(s.source),
      `${s.cue}: every sample names the URL it came from`);
    // CC-BY requires attribution BY NAME. CC0 does not, and demanding it there
    // would be theatre.
    if (/^CC-BY/.test(s.licence)) {
      assert.ok(s.attribution && s.attribution.length > 2,
        `${s.cue}: ${s.licence} requires an attribution line and there is none`);
    }
    const onDisk = path.join(ROOT, s.file);
    assert.ok(fs.existsSync(onDisk), `${s.cue}: ${s.file} is listed and not on disk`);
  }
});

test('the credits file exists and admits how many samples there are', () => {
  const credits = fs.readFileSync(path.join(ROOT, 'Assets', 'audio', 'CREDITS.md'), 'utf8');
  const samples = manifest.samples || [];
  if (!samples.length) {
    assert.match(credits, /currently none/i,
      'with no samples, the credits must say so rather than imply a library exists');
  } else {
    for (const s of samples) {
      assert.ok(credits.includes(s.file) || credits.includes(s.cue),
        `${s.cue} is in the manifest and not in the credits`);
    }
  }
});

// --- the player itself -------------------------------------------------------

const fakeCtx = () => {
  const played = [];
  return {
    played,
    createBufferSource() {
      const node = {
        buffer: null,
        playbackRate: { value: 1 },
        connect(next) { return next; },
        start() { played.push({ rate: node.playbackRate.value }); },
      };
      return node;
    },
    createGain() { return { gain: { value: 1 }, connect(next) { return next; } }; },
  };
};

test('an empty bank refuses every cue, so the synth keeps its voice', () => {
  // THE WHOLE POINT OF THE FALLBACK. If this returned true the game would go
  // silent the moment a sample failed to decode, which is strictly worse than
  // sounding electric.
  const bank = createSampleBank({ decode: async () => ({}), fetchFn: async () => new ArrayBuffer(8) });
  const ctx = fakeCtx();
  assert.equal(bank.play('uiTick', { ctx, destination: {} }), false);
  assert.equal(bank.has('uiTick'), false);
});

test('a loaded cue plays, and a cue that failed to decode does not', () => {
  const bank = createSampleBank({
    decode: async (data) => { if (data.byteLength === 0) throw new Error('bad data'); return { ok: true }; },
    fetchFn: async (url) => new ArrayBuffer(url.includes('broken') ? 0 : 8),
  });
  return bank.loadAll([
    { cue: 'ledgerTurn', file: 'a/good.wav' },
    { cue: 'uiTick', file: 'a/broken.wav' },
  ]).then((result) => {
    assert.equal(result.loaded, 1);
    assert.equal(result.failed, 1);
    const ctx = fakeCtx();
    assert.equal(bank.play('ledgerTurn', { ctx, destination: {} }), true);
    assert.equal(bank.play('uiTick', { ctx, destination: {} }), false,
      'a broken sample falls through to the synth rather than playing silence');
    // and it says WHICH file failed, rather than a count nobody can act on
    assert.match(bank.diagnostics().failures[0].file, /broken/);
  });
});

test('a rapid retrigger does not machine-gun one identical file', () => {
  // The tell that gives a sample library away: four coins, four bit-identical
  // impacts. The guard is time-based so it cannot be defeated by the caller.
  let clock = 0;
  const bank = createSampleBank({
    decode: async () => ({}), fetchFn: async () => new ArrayBuffer(8), now: () => clock,
  });
  return bank.loadAll([{ cue: 'coinDeposit', file: 'a/coin.wav' }]).then(() => {
    const ctx = fakeCtx();
    assert.equal(bank.play('coinDeposit', { ctx, destination: {}, minGapSec: 0.05 }), true);
    assert.equal(bank.play('coinDeposit', { ctx, destination: {}, minGapSec: 0.05 }), false,
      'the second impact inside the gap is refused');
    clock = 0.06;
    assert.equal(bank.play('coinDeposit', { ctx, destination: {}, minGapSec: 0.05 }), true,
      'and allowed once the gap has passed');
  });
});

test('playback is varied, so the same recording is not heard identically twice', () => {
  const bank = createSampleBank({ decode: async () => ({}), fetchFn: async () => new ArrayBuffer(8) });
  return bank.loadAll([{ cue: 'billDeposit', file: 'a/bill.wav' }]).then(() => {
    const ctx = fakeCtx();
    let clock = 0;
    const rates = [];
    for (let i = 0; i < 12; i += 1) {
      clock += 1;
      bank.play('billDeposit', {
        ctx, destination: {}, minGapSec: 0, now: () => clock, random: () => (i % 7) / 7,
      });
    }
    for (const p of ctx.played) rates.push(p.rate);
    assert.ok(new Set(rates.map((r) => r.toFixed(4))).size > 1,
      'the playback rate must vary between plays');
    for (const r of rates) {
      assert.ok(r > 0.8 && r < 1.25, `the variation must stay musical, got rate ${r}`);
    }
  });
});

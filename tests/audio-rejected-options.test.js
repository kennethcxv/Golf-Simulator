// PLAYTEST 4, ITEM 1 — THE REJECTED RECORDINGS STAY REJECTED.
//
// "Delete the other options in those four families and remove their files. I do
// not want them coming back by re-vendoring, the way the Kenney sci-fi set did."
//
// That last clause is the whole reason this file exists. Deleting a variant from
// the recipe is not enough: the recipe is rebuilt from a shopping list, and a
// shopping list entry that still names a struck sound will quietly re-download it
// the next time anyone runs the fetcher. The Kenney set came back exactly that
// way. So the verdict is recorded ONCE, in cue-plan.json's `_rejected` block, and
// this test reads it back and fails if any of it has returned to:
//
//   the shopping list (tools/audio/cue-plan.json  -> it would be re-downloaded)
//   the recipe        (tools/audio/recipe.json    -> it would be re-cut)
//   the manifest      (Assets/audio/manifest.json -> it would be loaded)
//   the disk          (Assets/audio/*.ogg         -> it would be playable)
//
// A test that only checked one of those four would pass on a build where the
// sound is on disk and audible.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(REPO, p), 'utf8'));

const plan = read('tools/audio/cue-plan.json');
const recipe = read('tools/audio/recipe.json');
const manifest = read('Assets/audio/manifest.json');
const rejected = plan._rejected || [];

test('the rejection list is populated and carries its reasons', () => {
  assert.ok(rejected.length >= 23, `expected the struck recordings to be listed, saw ${rejected.length}`);
  for (const r of rejected) {
    assert.ok(r.basename, 'every rejected entry names the recording it struck');
    assert.ok(r.family, `${r.basename} must say which family it lost`);
    assert.ok(r.why, `${r.basename} must say why it was struck`);
  }
});

test('no rejected recording is back on the shopping list', () => {
  const names = new Set(plan.sounds.map((s) => s.basename));
  const ids = new Set(plan.sounds.map((s) => s.id));
  for (const r of rejected) {
    assert.equal(names.has(r.basename), false, `${r.basename} is back in cue-plan.json and would be re-downloaded`);
    // The id is checked as well as the name, because renaming the basename would
    // walk the same recording back in under a fresh label.
    if (r.id != null) assert.equal(ids.has(r.id), false, `freesound id ${r.id} (${r.basename}) is back under a new name`);
  }
});

test('no rejected recording is back in the recipe', () => {
  const sources = new Set(recipe.variants.map((v) => v.source));
  for (const r of rejected) {
    assert.equal(sources.has(r.basename), false, `${r.basename} is back in recipe.json and would be re-cut`);
  }
});

test('the four settled families offer exactly the winner and nothing else', () => {
  const WINNERS = { menuButton: 'felt-tap', drawerOpen: 'wood-deep', cashLand: 'paper', ledgerClose: 'book' };
  for (const [family, winner] of Object.entries(WINNERS)) {
    const options = new Set(manifest.samples.filter((s) => s.family === family).map((s) => s.option));
    assert.deepEqual([...options], [winner], `${family} should offer only "${winner}"`);
  }
});

test('the two re-sourced families offer at least four fresh candidates each', () => {
  for (const family of ['ledgerTurn', 'ledgerPickup']) {
    const options = new Set(manifest.samples.filter((s) => s.family === family).map((s) => s.option));
    assert.ok(options.size >= 4, `${family} should offer at least 4 new candidates, saw ${options.size}`);
    // And every one of them must be a recording he has NOT already turned down.
    const struck = new Set(rejected.filter((r) => r.family === family).map((r) => r.basename));
    for (const s of manifest.samples.filter((x) => x.family === family)) {
      assert.equal(struck.has(s.option), false, `${family}/${s.option} was already rejected`);
    }
  }
});

test('no rejected file is still on disk or in the manifest', () => {
  const named = new Set(manifest.samples.map((s) => s.file.replace(/^Assets\/audio\//, '')));
  const onDisk = fs.readdirSync(path.join(REPO, 'Assets', 'audio')).filter((f) => f.endsWith('.ogg'));
  // Every ogg present must be one the manifest vouches for -- an orphan is a file
  // with no licence record, which is the shape the licence gate cannot see.
  for (const f of onDisk) assert.ok(named.has(f), `${f} is on disk with no manifest entry`);
  for (const f of named) {
    assert.ok(fs.existsSync(path.join(REPO, 'Assets', 'audio', f)), `${f} is in the manifest but missing from disk`);
  }
});

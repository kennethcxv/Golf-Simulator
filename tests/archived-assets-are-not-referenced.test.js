import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  archivedTargets,
  scanLinesForArchived,
  checkArchivedReferences,
  inventory,
  renderManifest,
  readArchive,
} from '../tools/asset-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// STEP ONE, FIRST PART — THE THING THAT MAKES SESSIONS MIX ASSETS.
//
// hero/v3, hero/v4 and hero/v5 held the same ten filenames. Nothing on disk
// said which one shipped, so a session picking by name picked right one time in
// three. v3 and v4 are now under Assets/_archive/ and this is what keeps them
// there: a reference to either their new home OR their old one fails the suite.
//
// The old path matters MORE than the new one. After the move,
// `Assets/models/hero/v4/apparel_polo_hung.glb` resolves to nothing, and a
// missing GLB in this renderer is a caught fetch and a silent absence — the
// failure mode that hides. This check turns it into a red test.

test('nothing in src/ (or main.cjs, index.html, or the staging manifest) references an archived asset', () => {
  const hits = checkArchivedReferences();
  assert.deepEqual(
    hits.map((h) => `${h.file}:${h.line} -> ${h.target}`),
    [],
    'an archived path is still named in code; point it at the superseding asset in Assets/MANIFEST.md',
  );
});

test('the archive declares both a new home and a former path for every entry', () => {
  const archive = readArchive();
  assert.ok(archive.entries.length > 0, 'nothing declared archived — the check above would certify nothing');
  for (const e of archive.entries) {
    assert.ok(e.path && e.formerPath, `${e.path || '?'} must declare formerPath, or the old spelling goes unguarded`);
    assert.ok(e.supersededBy, `${e.path} must name what replaced it`);
    assert.ok(e.reason && e.reason.length > 12, `${e.path} must say why, or the next session re-litigates the move`);
    assert.ok(fs.existsSync(path.join(ROOT, e.path)), `${e.path} is declared archived but is not there`);
    assert.ok(!fs.existsSync(path.join(ROOT, e.formerPath)),
      `${e.formerPath} still exists — the move did not happen, and both copies are back on disk`);
    assert.ok(fs.existsSync(path.join(ROOT, e.supersededBy)), `${e.supersededBy} does not exist`);
  }
});

test('CONTROL: the scanner reports a hit when a line names an archived path', () => {
  // The instrument, run over a fixture rather than over the repo. Watched fail
  // for real as well: a `canonicalGlb: 'Assets/models/hero/v4/apparel_polo_hung.glb'`
  // added to src/render3d/clubhouse/merch.js made the first test above fail
  // with `src/render3d/clubhouse/merch.js:126`, and removing it made it pass.
  const targets = archivedTargets();
  const former = readArchive().entries[0].formerPath;
  const lines = [
    'const fine = "vendor/models/clubhouse/hero_polo_hung.glb";',
    `const dead = '${former}/apparel_polo_hung.glb';`,
    'const alsoFine = "Assets/models/hero/v5/apparel_polo_hung.glb";',
  ];
  const hits = scanLinesForArchived(lines, targets, 'fixture.js');
  assert.equal(hits.length, 1, 'exactly the archived line must be caught');
  assert.equal(hits[0].line, 2);
});

test('CONTROL: the scanner catches the NEW archive location too, not just the old spelling', () => {
  const targets = archivedTargets();
  const now = readArchive().entries[0].path;
  const hits = scanLinesForArchived([`import x from '${now}/apparel_polo_hung.glb';`], targets, 'fixture.js');
  assert.equal(hits.length, 1);
});

test('CONTROL: a clean line produces no hit, so the scanner is not simply always red', () => {
  const hits = scanLinesForArchived(
    ['const ok = "Assets/models/hero/v5/apparel_cap_peg.glb";'],
    archivedTargets(),
    'fixture.js',
  );
  assert.deepEqual(hits, []);
});

// The manifest is only a source of truth while it agrees with the tree. A
// checked-in document that drifts is worse than none: it is a wrong answer with
// a filename that says it is the right one.
test('Assets/MANIFEST.md is current', () => {
  const expected = renderManifest(inventory());
  const onDisk = fs.readFileSync(path.join(ROOT, 'Assets/MANIFEST.md'), 'utf8');
  assert.equal(onDisk, expected, 'stale — run: node tools/asset-manifest.mjs --write');
});

test('the manifest gives every asset one of the three statuses, and the hero line is unambiguous', () => {
  const { rows } = inventory();
  const allowed = new Set(['SHIPPING', 'NOT WIRED', 'SUPERSEDED']);
  for (const r of rows) assert.ok(allowed.has(r.status), `${r.file} has status ${r.status}`);

  const heroV5 = rows.filter((r) => r.file.startsWith('Assets/models/hero/v5/'));
  assert.ok(heroV5.length >= 15, `expected the v5 line, found ${heroV5.length} files`);
  const archived = rows.filter((r) => r.status === 'SUPERSEDED');
  assert.ok(archived.length >= 20, 'v3 and v4 should both be accounted for as SUPERSEDED');
  assert.ok(archived.every((r) => r.file.startsWith('Assets/_archive/')),
    'a SUPERSEDED asset must live in the archive, not beside the one that replaced it');
});

test('no loader in src/ names an asset that is not on disk', () => {
  // The other half of "which version is current": a path that rotted when a
  // file moved. THREE.js reports a failed texture/GLB fetch to a callback most
  // call sites pass as `() => {}`, so this never surfaces at runtime.
  const { missing } = inventory();
  assert.deepEqual(missing.map((m) => `${m.path} (${m.sites.join(', ')})`), []);
});

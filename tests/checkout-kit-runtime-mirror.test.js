// The checkout kit is authored into Assets/checkout/glb but the runtime loads
// exclusively from vendor/models/checkout (merch.js instantiateKit). The copy
// between them is manual - there is no staging script - so rebuilding an asset
// and forgetting to stage it leaves the game rendering the previous export
// while the canonical file, the previews and the audit all look correct.
//
// That failure is invisible: no error, no missing file, just a stale model. This
// pins the two directories together so it fails loudly at test time instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const CANON = path.join(ROOT, 'Assets', 'checkout', 'glb');
const STAGED = path.join(ROOT, 'vendor', 'models', 'checkout');

const glbs = (dir) => (fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.glb')).sort()
  : []);
const digest = (p) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');

test('every authored checkout GLB is staged to the directory the runtime loads', () => {
  const canonical = glbs(CANON);
  assert.ok(canonical.length > 0, 'expected authored checkout GLBs under Assets/checkout/glb');

  const missing = canonical.filter((f) => !fs.existsSync(path.join(STAGED, f)));
  assert.deepEqual(missing, [],
    `authored but never staged to vendor/models/checkout - the runtime cannot see these: ${missing.join(', ')}`);
});

test('staged checkout GLBs are byte-identical to their authored source', () => {
  const stale = [];
  for (const f of glbs(CANON)) {
    const a = path.join(CANON, f);
    const b = path.join(STAGED, f);
    if (!fs.existsSync(b)) continue;
    if (digest(a) !== digest(b)) {
      const newer = fs.statSync(a).mtimeMs > fs.statSync(b).mtimeMs ? 'canonical is newer' : 'staged is newer';
      stale.push(`${f} (${newer})`);
    }
  }
  assert.deepEqual(stale, [],
    `staged copies differ from source - re-copy Assets/checkout/glb -> vendor/models/checkout: ${stale.join(', ')}`);
});

test('no orphaned GLB is staged without an authored source', () => {
  const canonical = new Set(glbs(CANON));
  const orphans = glbs(STAGED).filter((f) => !canonical.has(f));
  assert.deepEqual(orphans, [],
    `staged with no authored source - these cannot be rebuilt: ${orphans.join(', ')}`);
});

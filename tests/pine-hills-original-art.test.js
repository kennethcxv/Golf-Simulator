import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const ART = Object.freeze({
  'public/assets/textures/clubhouse/pine-hills-course-photo-v1.png':
    '08af808b0431daa63a5f073ea615010797f7aa6a58aa1e1456829b6f67c091a4',
  'public/assets/textures/clubhouse/pine-hills-tournament-poster-background-v1.png':
    '3e652431d1b13ea37925fa8c688c3bb3ea3fb8dc5f7f336862e901925ac1ea3b',
  'public/assets/textures/shop/pine-hills-package-background-atlas-v1.png':
    'ea883f2e2db1eb2fa3e9b8bcef73313e6181cfb7122f5177c3cbab3f10a00c2c',
});

test('Pine Hills original art sources are present and provenance-locked', () => {
  for (const [path, expectedHash] of Object.entries(ART)) {
    const bytes = fs.readFileSync(new URL(path, ROOT));
    assert.ok(bytes.length > 500_000, `${path} retains production-resolution source art`);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expectedHash);
  }
});

test('generated backgrounds are integrated while display wording stays deterministic', () => {
  const clubhouse = fs.readFileSync(new URL('src/render3d/clubhouse.js', ROOT), 'utf8');
  const pine = fs.readFileSync(new URL('src/render3d/clubhouse/pineHillsInterior.js', ROOT), 'utf8');

  assert.match(clubhouse, /pine-hills-course-photo-v1\.png/);
  assert.match(clubhouse, /pine-hills-package-background-atlas-v1\.png/);
  assert.match(clubhouse, /context\.fillText\(clubName/);
  assert.match(clubhouse, /context\.fillText\(line/);
  assert.match(pine, /pine-hills-tournament-poster-background-v1\.png/);
  assert.match(pine, /context\.fillText\('MUNICIPAL OPEN'/);
  assert.match(pine, /brandLines\(clubName\)/);
});

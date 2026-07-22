import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the public menu contains no prototype or placeholder-build disclaimer', () => {
  const source = fs.readFileSync(new URL('../src/screens/menu.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /working build|placeholder art|prototype/i);
  assert.match(source, /Buy them broken\. Bring them back\. Build a club worth keeping\./);
});

test('the office course map uses live club branding rather than a placeholder name', () => {
  const source = fs.readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /PINEHOLLOW GOLF CLUB/);
  assert.match(source, /const mapName = \(state\.clubName \|\| 'THE CLUB'\)/);
});

test('the entrance monument carries live save branding over its baked source art', () => {
  const source = fs.readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8');
  assert.match(source, /function addLiveClubNamePanel\(model\)/);
  assert.match(source, /state\.clubName \|\| 'The Club'/);
  assert.match(source, /releaseRole = 'live-club-name'/);
  assert.match(source, /addLiveClubNamePanel\(m\)/);
});

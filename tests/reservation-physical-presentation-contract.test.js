import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the clubhouse poll reconciles arrived reservations into physical golfers', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse.js', import.meta.url),
    'utf8',
  );
  const poll = source.slice(
    source.indexOf('if (poll > 1.1)'),
    source.indexOf('// interior detail only draws'),
  );
  const arrivals = source.slice(
    source.indexOf('function updateArrivals()'),
    source.indexOf('function leaveQueue'),
  );

  assert.match(poll, /updateArrivals\(\)/,
    'reservation simulation and the physical clubhouse must reconcile during live updates');
  assert.match(arrivals, /spawnCustomer\(true, reservation\)/,
    'an arrived booking must create its visible golfer actor');
  assert.match(arrivals, /if \(spawnedReservationCustomer\) continue;/,
    'same-slot arrivals must be paced instead of overlapping at the exterior spawn point');
  assert.match(source, /if \(cEntering \|\| o\.stops\?\.\[o\.stopIdx\]\?\.kind === 'enter'\) continue;/,
    'the narrow entrance must not turn customer separation into a doorway blockade');
  assert.match(source, /for \(const col of custCols\) \{[\s\S]{0,300}if \(col\.door\) continue;/,
    'customer movement and pathfinding must both treat automatic doors as passable');
});

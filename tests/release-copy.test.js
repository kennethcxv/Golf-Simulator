import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the public menu contains no prototype or placeholder-build disclaimer', () => {
  const source = fs.readFileSync(new URL('../src/screens/menu.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /working build|placeholder art|prototype/i);
  assert.match(source, /Restore the clubhouse\. Rebuild the course\./);
});

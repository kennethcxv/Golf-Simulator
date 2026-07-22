import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const clubhouseSource = readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('the generated office access point can reach and prefer the laptop', () => {
  const start = clubhouseSource.indexOf('office.computerProp = addProp');
  const end = clubhouseSource.indexOf('office.laptop = laptop', start);
  assert.ok(start >= 0 && end > start, 'laptop interaction block must remain present');

  const block = clubhouseSource.slice(start, end);
  const radius = Number(block.match(/\br:\s*([0-9.]+)/)?.[1]);
  const focusBias = Number(block.match(/\bfocusBias:\s*([0-9.]+)/)?.[1]);
  assert.ok(radius >= 2.35, `laptop reach ${radius} must cover the 2.35 m clear-side access point`);
  assert.ok(focusBias >= 1.35, `laptop focus bias ${focusBias} must win over the adjacent wall map`);
});

test('the tool wheel accepts the mouse input advertised by its help text', () => {
  const rule = stylesSource.match(/\.tool-wheel\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(rule, /pointer-events:\s*auto\s*;/);
});

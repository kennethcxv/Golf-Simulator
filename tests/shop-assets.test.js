import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES } from '../src/data/shopLayout.js';
import { SHOP_FIXTURE_MODELS, SHOP_FIXTURE_MODEL_BY_KIND } from '../src/data/shopAssets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_CHUNK = 0x4e4f534a;

async function glbJson(name) {
  const file = path.join(ROOT, 'vendor', 'models', 'clubhouse', `${name}.glb`);
  const bytes = await readFile(file);
  assert.ok(bytes.length > 4_096, `${name}.glb contains production geometry`);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${name} has the GLB magic header`);
  assert.equal(bytes.readUInt32LE(4), 2, `${name} is glTF 2`);
  const length = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), JSON_CHUNK, `${name} starts with a JSON chunk`);
  return JSON.parse(bytes.toString('utf8', 20, 20 + length).replace(/\0+$/g, '').trim());
}

test('every production shop fixture is a valid project GLB with named material slots', async () => {
  assert.ok(SHOP_FIXTURE_MODELS.length >= 15, 'the physical fixture library is broad enough for the full shop');
  for (const name of SHOP_FIXTURE_MODELS) {
    const json = await glbJson(name);
    assert.ok(json.meshes?.length, `${name} has a mesh`);
    assert.ok(json.accessors?.some((a) => a.type === 'VEC3' && a.min && a.max), `${name} records finite geometry bounds`);
    assert.ok(json.materials?.length, `${name} has material slots`);
    for (const material of json.materials) {
      assert.match(material.name || '', /^M_/, `${name} material ${material.name} maps to the shared shop kit`);
    }
  }
});

test('every player-facing authored fixture kind resolves to its production module', () => {
  const covered = new Set(Object.keys(SHOP_FIXTURE_MODEL_BY_KIND));
  for (const fixture of FIXTURES.filter((f) => SHOP_FIXTURE_MODEL_BY_KIND[f.kind])) {
    assert.ok(covered.has(fixture.kind), `${fixture.id} kind ${fixture.kind} has a GLB contract`);
  }
  for (const required of ['shelf', 'rack', 'hatwall', 'shoerack', 'service', 'fittingroom', 'demo', 'demorack']) {
    assert.ok(covered.has(required), `${required} is no longer a placeholder-only fixture`);
  }
});
